import { firstTimeSeen } from "../first-time";
import { ownField } from "../model/own-field";
import { err, ok, type Result } from "../model/result";
import type { HostPort } from "../port";
import type { FileSystem } from "../store/fs";
import {
  catchRegistryIoAsync,
  isJsonObject,
  type JsonObject,
  loadRegistry,
  objectField,
  writeRegistry,
} from "./registry-file";
import { type LockTiming, systemLockTiming, withRegistryLock } from "./registry-lock";

// Repo id -> its entry as stored, so fields this version does not know survive.
interface Checkouts {
  readonly entries: JsonObject;
  readonly roots: ReadonlyMap<string, string>;
}

interface CheckoutSighting {
  readonly repo: string;
  readonly root: string;
  readonly at: Date;
}

function parseRoot(repo: string, entry: unknown): Result<string, string> {
  const root = isJsonObject(entry) ? ownField(entry, "root") : undefined;
  return typeof root === "string" && root !== ""
    ? ok(root)
    : err(`checkout of "${repo}" must be an object with a "root" path`);
}

function parseCheckouts(document: JsonObject): Result<Checkouts, string> {
  const entries = objectField(document, "checkouts");
  if (!entries.ok) {
    return entries;
  }
  const roots = new Map<string, string>();
  for (const [repo, entry] of Object.entries(entries.value)) {
    const root = parseRoot(repo, entry);
    if (!root.ok) {
      return root;
    }
    roots.set(repo, root.value);
  }
  return ok({ entries: entries.value, roots });
}

// Where each repo was last seen checked out on this machine. I/O errors from the FileSystem throw.
export function readCheckouts(
  fs: FileSystem,
  file: string,
): Result<ReadonlyMap<string, string>, string> {
  const registry = loadRegistry(fs, file, parseCheckouts);
  return registry.ok ? ok(registry.value.parsed.roots) : registry;
}

function store(
  fs: FileSystem,
  file: string,
  { repo, root, at }: CheckoutSighting,
): Result<void, string> {
  const registry = loadRegistry(fs, file, parseCheckouts);
  if (!registry.ok) {
    return registry;
  }
  const { document, parsed } = registry.value;
  if (parsed.roots.get(repo) !== root) {
    writeRegistry(fs, file, {
      ...document,
      checkouts: { ...parsed.entries, [repo]: { root, seen: at.toISOString() } },
    });
  }
  return ok(undefined);
}

// The latest sighting wins, so the sighting is stored only when the root differs from the one on
// record: a session working in the recorded work tree never writes.
async function record(
  fs: FileSystem,
  file: string,
  sighting: CheckoutSighting,
  timing: LockTiming,
): Promise<Result<void, string>> {
  const registry = loadRegistry(fs, file, parseCheckouts);
  if (!registry.ok || registry.value.parsed.roots.get(sighting.repo) === sighting.root) {
    return registry.ok ? ok(undefined) : registry;
  }
  return await withRegistryLock(fs, file, timing, () => store(fs, file, sighting));
}

interface RecorderDeps {
  readonly fs: FileSystem;
  readonly registryFile: string;
  readonly now: () => Date;
  readonly log: HostPort["log"];
  readonly timing?: LockTiming;
}

export type CheckoutRecorder = (repo: string, root: string) => Promise<void>;

// For hooks: a registry that cannot be read or written is logged and the call carries on. A
// registry that stays broken would be logged by every tool call, so each distinct problem is
// logged once per recorder.
export function createCheckoutRecorder(deps: RecorderDeps): CheckoutRecorder {
  const firstTime = firstTimeSeen();
  return async (repo, root) => {
    const result = await catchRegistryIoAsync(() =>
      record(
        deps.fs,
        deps.registryFile,
        { repo, root, at: deps.now() },
        deps.timing ?? systemLockTiming,
      ),
    );
    if (!result.ok && firstTime(result.error)) {
      deps.log("warn", "checkout not recorded", { repo, root, error: result.error });
    }
  };
}

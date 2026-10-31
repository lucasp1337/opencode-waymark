import { ownField } from "../model/own-field";
import { err, ok, type Result } from "../model/result";
import type { FileSystem } from "../store/fs";
import { type JsonObject, loadRegistry, objectField, writeRegistry } from "./registry-file";
import { type LockTiming, systemLockTiming, withRegistryLock } from "./registry-lock";

export interface OrgRef {
  readonly id: string;
  readonly owner: string;
}

// `from` becomes an alias of `into`: sessions in `from`'s repos resolve to `into`.
export interface OrgMerge {
  readonly into: string;
  readonly from: string;
}

interface Orgs {
  readonly orgs: JsonObject;
  // Merged org id -> the org that absorbed it. Never chained: a merge repoints earlier aliases.
  readonly aliases: Readonly<Record<string, string>>;
}

function parseAliases(document: JsonObject): Result<Record<string, string>, string> {
  const field = objectField(document, "aliases");
  if (!field.ok) {
    return field;
  }
  const aliases: [string, string][] = [];
  for (const [merged, target] of Object.entries(field.value)) {
    if (typeof target !== "string") {
      return err('"aliases" must map org ids to org ids');
    }
    aliases.push([merged, target]);
  }
  return ok(Object.fromEntries(aliases));
}

function parseOrgs(document: JsonObject): Result<Orgs, string> {
  const orgs = objectField(document, "orgs");
  const aliases = parseAliases(document);
  if (!orgs.ok) {
    return orgs;
  }
  return aliases.ok ? ok({ orgs: orgs.value, aliases: aliases.value }) : aliases;
}

function aliasOf(aliases: Orgs["aliases"], id: string): string | undefined {
  const target = ownField(aliases, id);
  return typeof target === "string" ? target : undefined;
}

export interface OrgEntry {
  // The org the repo belongs to now: `org` itself unless it was merged into another.
  readonly id: string;
  // True on the first sight of an org that was never registered or merged.
  readonly added: boolean;
}

function knownEntry({ orgs, aliases }: Orgs, id: string): OrgEntry | undefined {
  const absorbedBy = aliasOf(aliases, id);
  if (absorbedBy !== undefined) {
    return { id: absorbedBy, added: false };
  }
  return ownField(orgs, id) === undefined ? undefined : { id, added: false };
}

function register(fs: FileSystem, file: string, org: OrgRef): Result<OrgEntry, string> {
  const registry = loadRegistry(fs, file, parseOrgs);
  if (!registry.ok) {
    return registry;
  }
  const { document, parsed } = registry.value;
  const known = knownEntry(parsed, org.id);
  if (known !== undefined) {
    return ok(known);
  }
  writeRegistry(fs, file, {
    ...document,
    orgs: { ...parsed.orgs, [org.id]: { owner: org.owner } },
  });
  return ok({ id: org.id, added: true });
}

// Registers an org on first sight and says which org its repos belong to. A registry that cannot
// be understood is reported and left untouched. Known orgs are answered without the lock, since
// every session start asks. I/O errors from the FileSystem throw and are caught at the caller's
// edge.
export async function resolveOrg(
  fs: FileSystem,
  file: string,
  org: OrgRef,
  timing: LockTiming = systemLockTiming,
): Promise<Result<OrgEntry, string>> {
  const registry = loadRegistry(fs, file, parseOrgs);
  if (!registry.ok) {
    return registry;
  }
  const known = knownEntry(registry.value.parsed, org.id);
  return known === undefined
    ? await withRegistryLock(fs, file, timing, () => register(fs, file, org))
    : ok(known);
}

function knownOrgs(orgs: JsonObject): string {
  const ids = Object.keys(orgs);
  return ids.length === 0 ? "none" : ids.join(", ");
}

function mergeAllowed({ orgs, aliases }: Orgs, { into, from }: OrgMerge): Result<void, string> {
  if (into === from) {
    return err("an org cannot be merged into itself");
  }
  const unknown = [into, from].filter((id) => ownField(orgs, id) === undefined);
  if (unknown.length > 0) {
    return err(`unknown org ${unknown.join(" and ")}; known orgs: ${knownOrgs(orgs)}`);
  }
  const absorbedBy = aliasOf(aliases, from);
  if (absorbedBy !== undefined) {
    return err(`${from} was already merged into ${absorbedBy}`);
  }
  const intoAbsorbedBy = aliasOf(aliases, into);
  return intoAbsorbedBy === undefined
    ? ok(undefined)
    : err(`${into} was merged into ${intoAbsorbedBy}; merge into that org instead`);
}

function withMerge(aliases: Orgs["aliases"], { into, from }: OrgMerge): JsonObject {
  const repointed = Object.entries(aliases).map(([merged, target]) => [
    merged,
    target === from ? into : target,
  ]);
  return { ...Object.fromEntries(repointed), [from]: into };
}

// Read-only, so the caller can move memories before the merge is recorded: a crash in between
// leaves a merge that can simply be run again.
export function checkMerge(fs: FileSystem, file: string, merge: OrgMerge): Result<void, string> {
  const registry = loadRegistry(fs, file, parseOrgs);
  return registry.ok ? mergeAllowed(registry.value.parsed, merge) : registry;
}

export function recordMerge(
  fs: FileSystem,
  file: string,
  merge: OrgMerge,
  timing: LockTiming = systemLockTiming,
): Promise<Result<void, string>> {
  return withRegistryLock(fs, file, timing, () => {
    const registry = loadRegistry(fs, file, parseOrgs);
    if (!registry.ok) {
      return registry;
    }
    const allowed = mergeAllowed(registry.value.parsed, merge);
    if (!allowed.ok) {
      return allowed;
    }
    writeRegistry(fs, file, {
      ...registry.value.document,
      aliases: withMerge(registry.value.parsed.aliases, merge),
    });
    return ok(undefined);
  });
}

import { afterEach } from "bun:test";
import { join } from "node:path";
import { memoryCommandTool } from "../src/core/features/commands/memory-command";
import type { ReviewSignals } from "../src/core/features/commands/review-report";
import type { BudgetCaps } from "../src/core/features/save/budget";
import type { MemoryId } from "../src/core/model/id";
import { type Memory, newMemory } from "../src/core/model/memory";
import type { ScopeRef } from "../src/core/model/scope";
import type { Git, GitAnswer } from "../src/core/scope/git";
import { createSessionScopes, type SessionScopes } from "../src/core/scope/session-scopes";
import { nodeFileSystem } from "../src/core/store/fs";
import { type MemoryStore, openMemoryStore } from "../src/core/store/memory-store";
import { createFakeHost, type FakeHost } from "./fake-host";
import { memoryId } from "./memory-id";
import { rethrowCacheFailure } from "./rethrow-cache-failure";
import { useTempDirs } from "./temp-dir";
import { type ContentInput, validContent } from "./valid-content";

export const API_SESSION = "ses_api";
export const WEB_SESSION = "ses_web";
export const NOTES_SESSION = "ses_notes";

export const ACME_ORG = { level: "org", id: "github.com/acme" } as const satisfies ScopeRef;
export const LABS_ORG = { level: "org", id: "github.com/acme-labs" } as const satisfies ScopeRef;
export const API_REPO: ScopeRef = { level: "repo", id: "github.com/acme/api" };
export const USER: ScopeRef = { level: "user" };

// Memories are seeded at this instant and the commands run a day later.
export const SEEDED_AT = new Date("2026-03-01T10:00:00.000Z");
export const COMMAND_TIME = new Date("2026-03-02T10:00:00.000Z");

// Small, so a budget test needs only a few lines of text.
export const COMMAND_CAPS: BudgetCaps = { user: 50, org: 50, product: 50, repo: 50 };

const ORIGINS = new Map([
  ["/work/api", "git@github.com:acme/api.git"],
  ["/work/web", "git@github.com:acme-labs/web.git"],
]);

function found(value: string): GitAnswer {
  return { status: "found", value };
}

// /work/api is in the acme org, /work/web in acme-labs, /work/notes is not a repository.
const fakeGit: Git = {
  root: (dir) => (ORIGINS.has(dir) ? found(dir) : { status: "absent" }),
  originUrl: (root) => {
    const origin = ORIGINS.get(root);
    return origin === undefined ? { status: "absent" } : found(origin);
  },
};

export function idNumber(n: number): MemoryId {
  return memoryId(`01JB8Z6Q4R3M2N1P0V9W8X${String(n).padStart(4, "0")}`);
}

interface SeedSpec {
  readonly n: number;
  readonly scope: ScopeRef;
  readonly content: ContentInput;
  // The number of the memory this one replaces.
  readonly supersedes?: number;
}

export interface CommandFixture {
  readonly host: FakeHost;
  readonly store: MemoryStore;
  readonly scopes: SessionScopes;
  readonly dataDir: string;
  readonly registryFile: string;
  seed(spec: SeedSpec): Memory;
  run(args: string, sessionID?: string): Promise<string>;
  // A new activation over the same data: its own host and scopes, as in a later session.
  laterScopes(): { host: FakeHost; scopes: SessionScopes };
  // Resolves both repos once, so their orgs are in the registry.
  knowBothOrgs(): Promise<void>;
}

interface CommandSetup {
  readonly reviewSignals?: ReviewSignals;
}

function sessionsFor(host: FakeHost): void {
  host.sessions.set(API_SESSION, { id: API_SESSION, directory: "/work/api" });
  host.sessions.set(WEB_SESSION, { id: WEB_SESSION, directory: "/work/web" });
  host.sessions.set(NOTES_SESSION, { id: NOTES_SESSION, directory: "/work/notes" });
}

// Stores, scopes and the memory_command tool over a temp data dir, closed and deleted after each
// test.
export function useCommandFixture(setup: CommandSetup = {}): () => CommandFixture {
  const tempDir = useTempDirs();
  const stores: MemoryStore[] = [];
  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.close();
    }
  });
  return () => {
    const dataDir = tempDir();
    const registryFile = join(dataDir, "registry.json");
    const host = createFakeHost();
    sessionsFor(host);
    const { store } = openMemoryStore(dataDir, nodeFileSystem, {
      onCacheFailure: rethrowCacheFailure,
    });
    stores.push(store);
    const scopesOn = (activation: FakeHost) =>
      createSessionScopes({ host: activation, git: fakeGit, fs: nodeFileSystem, registryFile });
    const scopes = scopesOn(host);
    const signals = setup.reviewSignals ?? { leftIndex: [], noisy: [] };
    const tool = memoryCommandTool({
      host,
      store,
      scopes,
      now: () => COMMAND_TIME,
      caps: () => COMMAND_CAPS,
      fs: nodeFileSystem,
      registryFile,
      reviewSignals: () => signals,
    });
    host.registerTool(tool);
    return {
      host,
      store,
      scopes,
      dataDir,
      registryFile,
      seed: (spec) => {
        const origin = {
          id: idNumber(spec.n),
          scope: spec.scope,
          now: SEEDED_AT,
          ...(spec.supersedes === undefined ? {} : { supersedes: idNumber(spec.supersedes) }),
        };
        const memory = newMemory(validContent(spec.content), origin);
        store.save(memory);
        return memory;
      },
      run: (args, sessionID = API_SESSION) => host.callTool("memory_command", { args }, sessionID),
      laterScopes: () => {
        const later = createFakeHost();
        sessionsFor(later);
        return { host: later, scopes: scopesOn(later) };
      },
      knowBothOrgs: async () => {
        await scopes.chainFor(API_SESSION);
        await scopes.chainFor(WEB_SESSION);
      },
    };
  };
}

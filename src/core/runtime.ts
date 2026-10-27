import { join } from "node:path";
import { guardedTool } from "./features/guarded-tool";
import { memoryForgetTool } from "./features/lifecycle/memory-forget";
import { createJit } from "./features/recall/jit";
import { memoryReadTool } from "./features/recall/memory-read";
import { PRESETS } from "./features/recall/presets";
import { createRecallScopes } from "./features/recall/recall-scope";
import { createSessionBlocks } from "./features/recall/session-blocks";
import { memorySaveTool } from "./features/save/memory-save";
import { memoryUpdateTool } from "./features/save/memory-update";
import type { ToolDeps } from "./features/tool-deps";
import type { MemoryId } from "./model/id";
import { parseOptions } from "./options";
import type { HostPort } from "./port";
import type { Git } from "./scope/git";
import { createSessionScopes, type SessionScopes } from "./scope/session-scopes";
import type { SyncReport } from "./store/cache";
import type { FileSystem } from "./store/fs";
import { type MemoryStore, openMemoryStore } from "./store/memory-store";

export interface RuntimeDeps {
  readonly dataDir: string;
  readonly fs: FileSystem;
  readonly git: Git;
  readonly now: () => Date;
  readonly newId: () => MemoryId;
  // The plugin options from the user's opencode config, unparsed.
  readonly options: unknown;
}

export interface Runtime {
  dispose(): void;
}

// The preset becomes configurable with /memory setup; until then everyone gets Balanced.
const PRESET = PRESETS.balanced;

function logOpening(host: HostPort, report: SyncReport, cacheReset: string | undefined): void {
  if (cacheReset !== undefined) {
    host.log("warn", "memory cache recreated", { reason: cacheReset });
  }
  host.log("info", "memory cache synced", { indexed: report.indexed, removed: report.removed });
  for (const invalid of report.invalid) {
    host.log("warn", "memory file skipped", invalid);
  }
}

interface Wiring {
  readonly host: HostPort;
  readonly deps: RuntimeDeps;
  readonly store: MemoryStore;
  readonly scopes: SessionScopes;
}

function registerTools({ host, deps, store, scopes }: Wiring): void {
  const toolDeps: ToolDeps = {
    host,
    store,
    scopes,
    now: deps.now,
    newId: deps.newId,
    caps: PRESET.caps,
  };
  const tools = [memorySaveTool, memoryUpdateTool, memoryReadTool, memoryForgetTool];
  for (const tool of tools) {
    host.registerTool(guardedTool(host, tool(toolDeps)));
  }
}

// Recall reaches the agent through the system prompt and tool outputs; a host lacking either
// degrades to the rest.
function registerRecall({ host, deps, store, scopes }: Wiring): void {
  const { options, problems } = parseOptions(deps.options);
  for (const problem of problems) {
    host.log("warn", "plugin option ignored", { problem });
  }
  const recall = createRecallScopes({ host, scopes, subagents: options.subagents });
  const recallScope = (sessionID: string) => recall.recallScope(sessionID);
  const forgetters: Array<{ forget(sessionID: string): void }> = [recall];
  if (host.capabilities.systemInjection) {
    const blocks = createSessionBlocks({
      store,
      recallScope,
      indexLines: PRESET.indexLines,
      log: host.log,
    });
    host.onSystem((sessionID) => blocks.blockFor(sessionID));
    forgetters.push(blocks);
  }
  if (host.capabilities.toolOutputMutation) {
    const jit = createJit({ recallScope, store });
    host.onUserMessage((sessionID, text) => jit.onUserMessage(sessionID, text));
    host.onToolAfter((call) => jit.onToolAfter(call));
    forgetters.push(jit);
  }
  // Per-session state would otherwise grow for as long as opencode runs.
  host.onSessionEvent((event) => {
    if (event.type === "deleted") {
      for (const forgetter of forgetters) {
        forgetter.forget(event.sessionID);
      }
    }
    return Promise.resolve();
  });
}

function wire(host: HostPort, deps: RuntimeDeps, store: MemoryStore): void {
  const scopes = createSessionScopes({
    host,
    git: deps.git,
    fs: deps.fs,
    registryFile: join(deps.dataDir, "registry.json"),
  });
  const wiring = { host, deps, store, scopes };
  registerTools(wiring);
  registerRecall(wiring);
}

// One activation: everything stateful is created here and released by dispose.
export function createRuntime(host: HostPort, deps: RuntimeDeps): Runtime {
  const { store, report, cacheReset } = openMemoryStore(deps.dataDir, deps.fs);
  logOpening(host, report, cacheReset);
  try {
    wire(host, deps, store);
  } catch (error) {
    store.close();
    throw error;
  }
  let disposed = false;
  return {
    dispose() {
      if (!disposed) {
        disposed = true;
        store.close();
        host.log("info", "runtime disposed");
      }
    },
  };
}

// A failed start leaves Waymark inert for this activation instead of breaking opencode.
export function activate(host: HostPort, deps: RuntimeDeps): Runtime {
  try {
    return createRuntime(host, deps);
  } catch (error) {
    host.log("error", "activation failed", { error: String(error) });
    return { dispose: () => undefined };
  }
}

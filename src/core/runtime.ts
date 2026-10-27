import { join } from "node:path";
import { guardedTool } from "./features/guarded-tool";
import { DEFAULT_LIFECYCLE } from "./features/lifecycle/lifecycle-settings";
import { memoryForgetTool } from "./features/lifecycle/memory-forget";
import { createLazyEmbedder, type LazyEmbedder } from "./features/recall/embeddings/lazy-embedder";
import { createJit } from "./features/recall/jit";
import { memoryReadTool } from "./features/recall/memory-read";
import { memorySearchTool } from "./features/recall/memory-search";
import { PRESETS } from "./features/recall/presets";
import { createRecallScopes } from "./features/recall/recall-scope";
import { createRetriever } from "./features/recall/retriever";
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
import type { Embedder } from "./store/embedder";
import type { FileSystem } from "./store/fs";
import { type MemoryStore, openMemoryStore } from "./store/memory-store";
import { openVectorIndex, type VectorIndex } from "./store/vector-index";
import { lenientTelemetry } from "./telemetry/lenient-telemetry";
import { openTelemetry, type Telemetry } from "./telemetry/telemetry";

export interface RuntimeDeps {
  readonly dataDir: string;
  readonly fs: FileSystem;
  readonly git: Git;
  readonly now: () => Date;
  readonly newId: () => MemoryId;
  // Loads the local embedding model; called at most once, on the first search.
  readonly loadEmbedder: () => Promise<Embedder>;
  // The plugin options from the user's opencode config, unparsed.
  readonly options: unknown;
}

export interface Runtime {
  dispose(): void;
}

// The preset becomes configurable with /memory setup; until then everyone gets Balanced.
const PRESET = PRESETS.balanced;

function openCounters(host: HostPort, deps: RuntimeDeps): Telemetry {
  const { telemetry, reset } = openTelemetry(join(deps.dataDir, "telemetry.sqlite"), deps.now, {
    fireRetentionDays: DEFAULT_LIFECYCLE.noisy.days,
  });
  if (reset !== undefined) {
    host.log("warn", "telemetry recreated", { reason: reset });
  }
  return lenientTelemetry(telemetry, host.log);
}

function logOpening(host: HostPort, report: SyncReport, cacheReset: string | undefined): void {
  if (cacheReset !== undefined) {
    host.log("warn", "memory cache recreated", { reason: cacheReset });
  }
  host.log("info", "memory cache synced", { indexed: report.indexed, removed: report.removed });
  for (const invalid of report.invalid) {
    host.log("warn", "memory file skipped", invalid);
  }
}

// What one activation opens and must release again.
interface Resources {
  readonly store: MemoryStore;
  readonly vectors: VectorIndex;
  readonly embedder: LazyEmbedder;
  readonly counters: Telemetry;
}

interface Wiring extends Resources {
  readonly host: HostPort;
  readonly deps: RuntimeDeps;
  readonly scopes: SessionScopes;
}

function registerTools({ host, deps, store, vectors, embedder, counters, scopes }: Wiring): void {
  const toolDeps: ToolDeps = {
    host,
    store,
    scopes,
    now: deps.now,
    newId: deps.newId,
    caps: PRESET.caps,
    retriever: createRetriever({ store, vectors, embedder, log: host.log }),
  };
  const tools = [
    memorySaveTool(toolDeps),
    memoryUpdateTool(toolDeps),
    memoryReadTool({ store, counters }),
    memorySearchTool(toolDeps),
    memoryForgetTool(toolDeps),
  ];
  for (const tool of tools) {
    host.registerTool(guardedTool(host, tool));
  }
}

// Recall reaches the agent through the system prompt and tool outputs; a host lacking either
// degrades to the rest.
function registerRecall({ host, deps, store, counters, scopes }: Wiring): void {
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
      indexLines: () => PRESET.indexLines,
      indexExit: () => DEFAULT_LIFECYCLE.indexExit,
      counters,
      now: deps.now,
      log: host.log,
    });
    host.onSystem((sessionID) => blocks.blockFor(sessionID));
    forgetters.push(blocks);
  }
  if (host.capabilities.toolOutputMutation) {
    const jit = createJit({ recallScope, store, counters, noisy: DEFAULT_LIFECYCLE.noisy });
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

function wire(host: HostPort, deps: RuntimeDeps, resources: Resources): void {
  const scopes = createSessionScopes({
    host,
    git: deps.git,
    fs: deps.fs,
    registryFile: join(deps.dataDir, "registry.json"),
  });
  const wiring = { host, deps, ...resources, scopes };
  registerTools(wiring);
  registerRecall(wiring);
}

// One activation: everything stateful is created here and released by dispose.
export function createRuntime(host: HostPort, deps: RuntimeDeps): Runtime {
  const { store, report, cacheReset } = openMemoryStore(deps.dataDir, deps.fs);
  logOpening(host, report, cacheReset);
  const open: Array<{ close(): void }> = [store];
  try {
    const { index: vectors, reset } = openVectorIndex(join(deps.dataDir, "vectors.sqlite"));
    open.push(vectors);
    if (reset !== undefined) {
      host.log("warn", "vector cache recreated", { reason: reset });
    }
    const embedder = createLazyEmbedder(deps.loadEmbedder, host.log);
    open.push(embedder);
    const counters = openCounters(host, deps);
    open.push(counters);
    wire(host, deps, { store, vectors, embedder, counters });
  } catch (error) {
    for (const resource of open) {
      resource.close();
    }
    throw error;
  }
  let disposed = false;
  return {
    dispose() {
      if (!disposed) {
        disposed = true;
        for (const resource of open) {
          resource.close();
        }
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

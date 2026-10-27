import { join } from "node:path";
import { type ConfigStore, openConfigStore } from "./config/config-store";
import { type MemoryCommandDeps, memoryCommandTool } from "./features/commands/memory-command";
import { commandTemplates } from "./features/commands/templates";
import { guardedTool } from "./features/guarded-tool";
import { compactionNote } from "./features/lifecycle/compaction";
import { DEFAULT_LIFECYCLE } from "./features/lifecycle/lifecycle-settings";
import { memoryForgetTool } from "./features/lifecycle/memory-forget";
import { createReviewSignals } from "./features/lifecycle/review-signals";
import { createLazyEmbedder, type LazyEmbedder } from "./features/recall/embeddings/lazy-embedder";
import { createJit } from "./features/recall/jit";
import { memoryReadTool } from "./features/recall/memory-read";
import { memorySearchTool } from "./features/recall/memory-search";
import { createRecallScopes, type RecallScope } from "./features/recall/recall-scope";
import { createRetriever } from "./features/recall/retriever";
import { createSessionBlocks } from "./features/recall/session-blocks";
import { memorySaveTool } from "./features/save/memory-save";
import { memoryUpdateTool } from "./features/save/memory-update";
import { createFirstSessionNotice } from "./features/setup/first-session";
import { memoryConfigTool } from "./features/setup/memory-config";
import { SETUP_INSTRUCTIONS } from "./features/setup/setup-command";
import { withToastSetting } from "./features/setup/toast-setting";
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
  readonly config: ConfigStore;
  readonly scopes: SessionScopes;
  readonly registryFile: string;
}

function toolDepsOf(wiring: Wiring): ToolDeps {
  const { host, deps, store, vectors, embedder, config, scopes } = wiring;
  return {
    host,
    store,
    scopes,
    now: deps.now,
    newId: deps.newId,
    // Read per save, so a cap raised with memory_config applies at once.
    caps: () => config.current().caps,
    retriever: createRetriever({ store, vectors, embedder, log: host.log }),
  };
}

function commandToolDeps(wiring: Wiring, toolDeps: ToolDeps): MemoryCommandDeps {
  const { deps, store, counters, config, registryFile } = wiring;
  const reviewSignals = createReviewSignals({
    store,
    counters,
    now: deps.now,
    indexExit: () => config.current().indexExit,
    noisy: DEFAULT_LIFECYCLE.noisy,
  });
  return { ...toolDeps, fs: deps.fs, registryFile, reviewSignals };
}

function registerTools(wiring: Wiring): void {
  const { host, store, counters, config } = wiring;
  const toolDeps = toolDepsOf(wiring);
  const tools = [
    memorySaveTool(toolDeps),
    memoryUpdateTool(toolDeps),
    memoryReadTool({ store, counters }),
    memorySearchTool(toolDeps),
    memoryForgetTool(toolDeps),
    memoryConfigTool({ config }),
    memoryCommandTool(commandToolDeps(wiring, toolDeps)),
  ];
  for (const tool of tools) {
    host.registerTool(guardedTool(host, tool));
  }
}

function registerCommands(host: HostPort): void {
  for (const command of commandTemplates(SETUP_INSTRUCTIONS)) {
    host.registerCommand(command.name, command.description, command.template);
  }
}

type RecallScopeOf = (sessionID: string) => Promise<RecallScope | null>;

interface Forgetter {
  forget(sessionID: string): void;
}

// Subagents opted in through the plugin option or the setting both receive recall.
function subagentsOf({ host, deps, config }: Wiring): () => readonly string[] {
  const { options, problems } = parseOptions(deps.options);
  for (const problem of problems) {
    host.log("warn", "plugin option ignored", { problem });
  }
  return () => [...options.subagents, ...config.current().subagents];
}

function registerSessionBlocks(wiring: Wiring, recallScope: RecallScopeOf): Forgetter {
  const { host, deps, store, counters, config } = wiring;
  const blocks = createSessionBlocks({
    store,
    recallScope,
    indexLines: () => config.current().indexLines,
    indexExit: () => config.current().indexExit,
    counters,
    now: deps.now,
    log: host.log,
  });
  const firstSession = createFirstSessionNotice({ host, config });
  host.onSystem(async (sessionID) => {
    const block = await blocks.blockFor(sessionID);
    if (block !== null) {
      await firstSession();
    }
    return block;
  });
  return blocks;
}

function registerJit({ host, store, counters }: Wiring, recallScope: RecallScopeOf): Forgetter {
  const jit = createJit({ recallScope, store, counters, noisy: DEFAULT_LIFECYCLE.noisy });
  host.onUserMessage((sessionID, text) => jit.onUserMessage(sessionID, text));
  host.onToolAfter((call) => jit.onToolAfter(call));
  return jit;
}

// Sessions without recall get no compaction note either.
function registerCompaction({ host, config }: Wiring, recallScope: RecallScopeOf): void {
  host.onCompaction(async (sessionID) =>
    (await recallScope(sessionID)) === null ? null : compactionNote(config.current()),
  );
}

// Recall reaches the agent through the system prompt and tool outputs; a host lacking either
// degrades to the rest.
function registerRecall(wiring: Wiring): void {
  const { host, scopes } = wiring;
  const recall = createRecallScopes({ host, scopes, subagents: subagentsOf(wiring) });
  const recallScope = (sessionID: string) => recall.recallScope(sessionID);
  const forgetters: Forgetter[] = [recall];
  if (host.capabilities.systemInjection) {
    forgetters.push(registerSessionBlocks(wiring, recallScope));
  }
  if (host.capabilities.toolOutputMutation) {
    forgetters.push(registerJit(wiring, recallScope));
  }
  if (host.capabilities.compactionHook) {
    registerCompaction(wiring, recallScope);
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

function wire(rawHost: HostPort, deps: RuntimeDeps, resources: Resources): void {
  const config = openConfigStore(deps.fs, join(deps.dataDir, "config.jsonc"), rawHost.log);
  const host = withToastSetting(rawHost, () => config.current().toasts);
  const registryFile = join(deps.dataDir, "registry.json");
  const scopes = createSessionScopes({ host, git: deps.git, fs: deps.fs, registryFile });
  const wiring = { host, deps, ...resources, config, scopes, registryFile };
  registerTools(wiring);
  registerCommands(host);
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

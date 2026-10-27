import { join } from "node:path";
import { guardedTool } from "./features/guarded-tool";
import { memoryReadTool } from "./features/recall/memory-read";
import { BALANCED_CAPS } from "./features/save/budget";
import { memorySaveTool } from "./features/save/memory-save";
import type { ToolDeps } from "./features/tool-deps";
import type { MemoryId } from "./model/id";
import type { HostPort } from "./port";
import type { Git } from "./scope/git";
import { createSessionScopes } from "./scope/session-scopes";
import type { SyncReport } from "./store/cache";
import type { FileSystem } from "./store/fs";
import { type MemoryStore, openMemoryStore } from "./store/memory-store";

export interface RuntimeDeps {
  readonly dataDir: string;
  readonly fs: FileSystem;
  readonly git: Git;
  readonly now: () => Date;
  readonly newId: () => MemoryId;
}

export interface Runtime {
  dispose(): void;
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

function registerTools(host: HostPort, deps: RuntimeDeps, store: MemoryStore): void {
  const scopes = createSessionScopes({
    host,
    git: deps.git,
    fs: deps.fs,
    registryFile: join(deps.dataDir, "registry.json"),
  });
  const toolDeps: ToolDeps = {
    host,
    store,
    scopes,
    now: deps.now,
    newId: deps.newId,
    caps: BALANCED_CAPS,
  };
  const tools = [memorySaveTool, memoryReadTool];
  for (const tool of tools) {
    host.registerTool(guardedTool(host, tool(toolDeps)));
  }
}

// One activation: everything stateful is created here and released by dispose.
export function createRuntime(host: HostPort, deps: RuntimeDeps): Runtime {
  const { store, report, cacheReset } = openMemoryStore(deps.dataDir, deps.fs);
  logOpening(host, report, cacheReset);
  try {
    registerTools(host, deps, store);
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

import { isIndexed } from "../../model/kind";
import { activeOnly } from "../../model/memory";
import { type ScopeChain, scopeAt } from "../../model/scope";
import type { HostPort } from "../../port";
import { productRepos } from "../../scope/products";
import { catchRegistryIo } from "../../scope/registry-file";
import type { FileSystem } from "../../store/fs";
import type { MemoryStore } from "../../store/memory-store";
import type { Telemetry } from "../../telemetry/telemetry";
import type { IndexExitThresholds } from "../lifecycle/lifecycle-settings";
import { type Baseline, baselineOf } from "./fresh-memories";
import type { RecallScope } from "./recall-scope";
import { renderSessionBlock } from "./session-block";

interface SessionBlockDeps {
  readonly store: Pick<MemoryStore, "inScopes">;
  readonly fs: FileSystem;
  readonly registryFile: string;
  readonly recallScope: (sessionID: string) => Promise<RecallScope | null>;
  // Read per rendering, so a changed setting applies to the next session without a restart.
  readonly indexLines: () => number;
  readonly indexExit: () => IndexExitThresholds;
  readonly counters: Pick<Telemetry, "stats" | "recordSessions">;
  readonly now: () => Date;
  readonly log: HostPort["log"];
}

function productReposOf(deps: SessionBlockDeps, chain: ScopeChain): readonly string[] {
  const product = scopeAt(chain, "product");
  if (product?.level !== "product") {
    return [];
  }
  const repos = catchRegistryIo(() => productRepos(deps.fs, deps.registryFile, product.id));
  if (!repos.ok) {
    deps.log("warn", "product repos not listed in session block", { error: repos.error });
    return [];
  }
  return repos.value;
}

async function render(
  deps: SessionBlockDeps,
  sessionID: string,
  baselines: Map<string, Baseline>,
): Promise<string | null> {
  const scope = await deps.recallScope(sessionID);
  if (scope === null) {
    deps.log("info", "no recall for session", { sessionID });
    return null;
  }
  const memories = activeOnly(deps.store.inScopes(scope.chain));
  baselines.set(sessionID, baselineOf(memories));
  const indexed = memories.filter((memory) => isIndexed(memory.kind)).map((memory) => memory.id);
  const usage = { stats: deps.counters.stats(indexed), now: deps.now(), exit: deps.indexExit() };
  const block = renderSessionBlock({
    chain: scope.chain,
    productRepos: productReposOf(deps, scope.chain),
    memories,
    indexLines: deps.indexLines(),
    usage,
  });
  // Counted after the decision, so the session that reaches the threshold still shows the memory.
  // This write happens once per session, never per request.
  deps.counters.recordSessions(indexed);
  // The evidence for "this session saw that rule".
  deps.log("info", "session block rendered", { sessionID, memories: block.shown });
  return block.text;
}

// The host asks on every model request (title and compaction requests included); the block is
// rendered once per session and repeated verbatim, so saves made later never shift it.
export function createSessionBlocks(deps: SessionBlockDeps) {
  const blocks = new Map<string, Promise<string | null>>();
  const baselines = new Map<string, Baseline>();
  return {
    blockFor(sessionID: string): Promise<string | null> {
      const known = blocks.get(sessionID);
      if (known !== undefined) {
        return known;
      }
      const pending = render(deps, sessionID, baselines);
      blocks.set(sessionID, pending);
      pending.catch(() => blocks.delete(sessionID));
      return pending;
    },
    // What the frozen block was rendered from; undefined until it is.
    baselineOf(sessionID: string): Baseline | undefined {
      return baselines.get(sessionID);
    },
    forget(sessionID: string): void {
      blocks.delete(sessionID);
      baselines.delete(sessionID);
    },
  };
}

import { isIndexed } from "../../model/kind";
import { activeOnly } from "../../model/memory";
import type { HostPort } from "../../port";
import type { MemoryStore } from "../../store/memory-store";
import type { Telemetry } from "../../telemetry/telemetry";
import type { IndexExitThresholds } from "../lifecycle/lifecycle-settings";
import type { RecallScope } from "./recall-scope";
import { renderSessionBlock } from "./session-block";

interface SessionBlockDeps {
  readonly store: Pick<MemoryStore, "inScopes">;
  readonly recallScope: (sessionID: string) => Promise<RecallScope | null>;
  // Read per rendering, so a changed setting applies to the next session without a restart.
  readonly indexLines: () => number;
  readonly indexExit: () => IndexExitThresholds;
  readonly counters: Pick<Telemetry, "stats" | "recordSessions">;
  readonly now: () => Date;
  readonly log: HostPort["log"];
}

async function render(deps: SessionBlockDeps, sessionID: string): Promise<string | null> {
  const scope = await deps.recallScope(sessionID);
  if (scope === null) {
    deps.log("info", "no recall for session", { sessionID });
    return null;
  }
  const memories = activeOnly(deps.store.inScopes(scope.chain));
  const indexed = memories.filter((memory) => isIndexed(memory.kind)).map((memory) => memory.id);
  const usage = { stats: deps.counters.stats(indexed), now: deps.now(), exit: deps.indexExit() };
  const block = renderSessionBlock({
    chain: scope.chain,
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
  return {
    blockFor(sessionID: string): Promise<string | null> {
      const known = blocks.get(sessionID);
      if (known !== undefined) {
        return known;
      }
      const pending = render(deps, sessionID);
      blocks.set(sessionID, pending);
      pending.catch(() => blocks.delete(sessionID));
      return pending;
    },
    forget(sessionID: string): void {
      blocks.delete(sessionID);
    },
  };
}

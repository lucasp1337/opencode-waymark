import { activeOnly } from "../../model/memory";
import type { MemoryStore } from "../../store/memory-store";
import type { RecallScope } from "./recall-scope";
import { renderSessionBlock } from "./session-block";

interface SessionBlockDeps {
  readonly store: Pick<MemoryStore, "inScopes">;
  readonly recallScope: (sessionID: string) => Promise<RecallScope | null>;
  readonly indexLines: number;
}

async function render(deps: SessionBlockDeps, sessionID: string): Promise<string | null> {
  const scope = await deps.recallScope(sessionID);
  if (scope === null) {
    return null;
  }
  const memories = activeOnly(deps.store.inScopes(scope.chain));
  return renderSessionBlock({ chain: scope.chain, memories, indexLines: deps.indexLines });
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
  };
}

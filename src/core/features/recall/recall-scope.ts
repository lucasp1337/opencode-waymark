import { repoIdIn, type ScopeChain } from "../../model/scope";
import type { HostPort, SessionMeta } from "../../port";
import type { CheckoutRecorder } from "../../scope/checkouts";
import type { SessionScopes } from "../../scope/session-scopes";

export interface RecallScope {
  readonly chain: ScopeChain;
  readonly directory: string;
}

// Subagent sessions get nothing unless the user listed their agent in the `subagents` option or
// setting.
export function receivesRecall(meta: SessionMeta, subagents: readonly string[]): boolean {
  return (
    meta.parentID === undefined || (meta.agent !== undefined && subagents.includes(meta.agent))
  );
}

interface RecallScopeDeps {
  readonly host: Pick<HostPort, "sessionMeta">;
  readonly scopes: SessionScopes;
  readonly recordCheckout: CheckoutRecorder;
  // Read when a session is first seen, so a changed setting applies to the next session.
  readonly subagents: () => readonly string[];
}

async function resolve(deps: RecallScopeDeps, sessionID: string): Promise<RecallScope | null> {
  const meta = await deps.host.sessionMeta(sessionID);
  if (!receivesRecall(meta, deps.subagents())) {
    return null;
  }
  const { chain, root } = await deps.scopes.resolveSession(sessionID);
  const repo = repoIdIn(chain);
  if (repo !== undefined && root !== undefined) {
    // Not awaited: the recorder logs its own failures and may wait for the registry lock. Once per
    // session, since a session's recall scope is decided once.
    void deps.recordCheckout(repo, root);
  }
  return { chain, directory: meta.directory };
}

// Decided once per session: null means the session gets no recall at all.
export function createRecallScopes(deps: RecallScopeDeps) {
  const decided = new Map<string, Promise<RecallScope | null>>();
  return {
    recallScope(sessionID: string): Promise<RecallScope | null> {
      const known = decided.get(sessionID);
      if (known !== undefined) {
        return known;
      }
      const pending = resolve(deps, sessionID);
      decided.set(sessionID, pending);
      // A failure is not remembered, so the next hook call asks again.
      pending.catch(() => decided.delete(sessionID));
      return pending;
    },
    forget(sessionID: string): void {
      decided.delete(sessionID);
    },
  };
}

import type { ScopeChain } from "../../model/scope";
import type { HostPort, SessionMeta } from "../../port";
import type { SessionScopes } from "../../scope/session-scopes";

export interface RecallScope {
  readonly chain: ScopeChain;
  readonly directory: string;
}

// Subagent sessions get nothing unless the user listed their agent in the `subagents` option.
export function receivesRecall(meta: SessionMeta, subagents: readonly string[]): boolean {
  return (
    meta.parentID === undefined || (meta.agent !== undefined && subagents.includes(meta.agent))
  );
}

interface RecallScopeDeps {
  readonly host: Pick<HostPort, "sessionMeta">;
  readonly scopes: SessionScopes;
  readonly subagents: readonly string[];
}

async function resolve(deps: RecallScopeDeps, sessionID: string): Promise<RecallScope | null> {
  const meta = await deps.host.sessionMeta(sessionID);
  if (!receivesRecall(meta, deps.subagents)) {
    return null;
  }
  return { chain: await deps.scopes.chainFor(sessionID), directory: meta.directory };
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
  };
}

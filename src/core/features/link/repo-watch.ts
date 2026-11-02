import type { ToolCallInfo } from "../../port";
import type { RepoIds } from "./repo-ids";
import type { createTouchedRoots } from "./touched-repos";

export interface SeenRepo {
  readonly root: string;
  readonly repo: string;
}

interface RepoWatchDeps {
  readonly repoIds: RepoIds;
  readonly touchedRoots: ReturnType<typeof createTouchedRoots>;
}

export interface RepoWatch {
  // The repos, own included, whose work trees this call touched or earlier calls of the session
  // left pending, and whose ids are known by now. A root's origin is looked up off the hook's
  // path, so a repo is first reported on a call after the one that touched it, and no call is
  // ever delayed. Asking again about the same call gives the same answer, so every hook of a call
  // shares one result.
  observe(call: ToolCallInfo, directory: string): SeenRepo[];
  // Drops what is kept for a session that no longer exists and gives failed lookups another go.
  forget(sessionID: string): void;
}

// Removes from `roots` every root whose lookup has finished and returns those with a repo id.
function drainKnown(repoIds: RepoIds, roots: Set<string>): SeenRepo[] {
  const seen: SeenRepo[] = [];
  for (const root of roots) {
    const found = repoIds.lookup(root);
    if (found.status === "pending") {
      continue;
    }
    roots.delete(root);
    if (found.status === "known" && found.repo !== undefined) {
      seen.push({ root, repo: found.repo });
    }
  }
  return seen;
}

export function createRepoWatch({ repoIds, touchedRoots }: RepoWatchDeps): RepoWatch {
  const pending = new Map<string, Set<string>>();
  const observed = new WeakMap<ToolCallInfo, SeenRepo[]>();
  return {
    observe(call, directory) {
      const known = observed.get(call);
      if (known !== undefined) {
        return known;
      }
      const roots = new Set([
        ...(pending.get(call.sessionID) ?? []),
        ...touchedRoots(call, directory),
      ]);
      const seen = drainKnown(repoIds, roots);
      pending.set(call.sessionID, roots);
      observed.set(call, seen);
      return seen;
    },
    forget(sessionID) {
      pending.delete(sessionID);
      repoIds.retryFailed();
    },
  };
}

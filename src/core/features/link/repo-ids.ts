import { repoIdIn } from "../../model/scope";
import type { HostPort } from "../../port";
import { resolveScopes } from "../../scope/chain";
import type { AsyncOriginUrl, Git, GitAnswer } from "../../scope/git";

// Looking an origin up costs a process, so a root is retried this often at most before it is
// left alone until the next retry window (a session ending).
const MAX_ATTEMPTS = 3;

type RepoLookup =
  | { readonly status: "pending" }
  // `repo` is undefined for a root whose repo has no id of its own.
  | { readonly status: "known"; readonly repo: string | undefined }
  | { readonly status: "failed" };

type Entry =
  | Extract<RepoLookup, { status: "known" }>
  | { readonly status: "pending" | "failed"; readonly attempts: number };

export interface RepoIds {
  // Answers from what is known and, for an unknown root, starts the lookup without waiting for
  // it: a later call finds the answer.
  lookup(root: string): RepoLookup;
  // Gives roots whose lookups gave up another chance.
  retryFailed(): void;
}

// Reuses the scope rules with the answers already in hand, so the repo id is derived in one place.
function answeredGit(root: string, origin: GitAnswer): Git {
  return { root: () => ({ status: "found", value: root }), originUrl: () => origin };
}

type Resolution = { readonly repo: string | undefined } | { readonly failure: string };

async function resolveRepo(originUrl: AsyncOriginUrl, root: string): Promise<Resolution> {
  try {
    const resolved = resolveScopes(root, answeredGit(root, await originUrl(root)));
    return resolved.failure === undefined
      ? { repo: repoIdIn(resolved.chain) }
      : { failure: resolved.failure };
  } catch (error) {
    return { failure: String(error) };
  }
}

// One entry per repo root, never per directory. A failure is not final: the root is looked up
// again on its next use, up to MAX_ATTEMPTS times.
export function createRepoIds(deps: {
  readonly originUrl: AsyncOriginUrl;
  readonly log: HostPort["log"];
}): RepoIds {
  const entries = new Map<string, Entry>();

  function start(root: string, attempts: number): void {
    entries.set(root, { status: "pending", attempts: attempts + 1 });
    resolveRepo(deps.originUrl, root)
      .then((resolution) => {
        if ("repo" in resolution) {
          entries.set(root, { status: "known", repo: resolution.repo });
          return;
        }
        deps.log("warn", "repo of a touched path not resolved", {
          root,
          failure: resolution.failure,
        });
        entries.set(root, { status: "failed", attempts: attempts + 1 });
      })
      .catch((error: unknown) => {
        deps.log("error", "repo lookup bookkeeping failed", { root, error: String(error) });
      });
  }

  return {
    lookup(root) {
      const entry = entries.get(root);
      if (entry === undefined || (entry.status === "failed" && entry.attempts < MAX_ATTEMPTS)) {
        start(root, entry?.status === "failed" ? entry.attempts : 0);
        return { status: "pending" };
      }
      return entry.status === "known" ? entry : { status: entry.status };
    },
    retryFailed() {
      for (const [root, entry] of entries) {
        if (entry.status === "failed") {
          entries.delete(root);
        }
      }
    },
  };
}

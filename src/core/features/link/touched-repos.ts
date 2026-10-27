import { dirname, resolve } from "node:path";
import { repoIdIn } from "../../model/scope";
import type { HostPort, ToolCallInfo } from "../../port";
import { resolveScopes } from "../../scope/chain";
import type { Git, GitAnswer } from "../../scope/git";
import type { FileSystem } from "../../store/fs";

interface TouchedRepoDeps {
  readonly git: Git;
  readonly fs: Pick<FileSystem, "isDirectory">;
  readonly log: HostPort["log"];
}

// The origin of a root does not change while the plugin runs, so a new directory in a known repo
// costs one `git rev-parse` only.
function memoizedOrigins(git: Git): Git {
  const origins = new Map<string, GitAnswer>();
  return {
    root: (dir) => git.root(dir),
    originUrl(root) {
      const known = origins.get(root);
      if (known !== undefined) {
        return known;
      }
      const answer = git.originUrl(root);
      origins.set(root, answer);
      return answer;
    },
  };
}

// A directory is resolved once, failures included: a git that hangs must not be waited for on
// every call.
function createDirectoryRepos({ git, log }: Pick<TouchedRepoDeps, "git" | "log">) {
  const origins = memoizedOrigins(git);
  const repos = new Map<string, string | undefined>();
  return (directory: string): string | undefined => {
    if (repos.has(directory)) {
      return repos.get(directory);
    }
    const resolved = resolveScopes(directory, origins);
    if (resolved.failure !== undefined) {
      log("warn", "repo of a touched path not resolved", {
        directory,
        failure: resolved.failure,
      });
    }
    const repo = repoIdIn(resolved.chain);
    repos.set(directory, repo);
    return repo;
  };
}

// The directory to ask git about: the path itself when it is one, else the directory it is in.
function directoryOf({ fs, log }: TouchedRepoDeps, path: string): string | undefined {
  try {
    return fs.isDirectory(path) ? path : dirname(path);
  } catch (error) {
    log("warn", "touched path not examined", { path, error: String(error) });
    return undefined;
  }
}

// The repo of each path a call touched, in the order it touched them; paths outside any repo
// are left out.
export function createTouchedRepos(
  deps: TouchedRepoDeps,
): (call: ToolCallInfo, directory: string) => string[] {
  const repoOf = createDirectoryRepos(deps);
  return (call, directory) =>
    call.touchedPaths.flatMap((path) => {
      const dir = directoryOf(deps, resolve(directory, path));
      const repo = dir === undefined ? undefined : repoOf(dir);
      return repo === undefined ? [] : [repo];
    });
}

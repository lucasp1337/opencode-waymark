import { dirname, join, resolve } from "node:path";
import type { HostPort, ToolCallInfo } from "../../port";
import type { FileSystem } from "../../store/fs";

interface TouchedRepoDeps {
  readonly fs: Pick<FileSystem, "isDirectory" | "mtimeMs">;
  readonly log: HostPort["log"];
}

// A work tree's root holds `.git`: a directory, or a file in a worktree or submodule. Only stats,
// so it is safe in a hook.
function repoRootAbove(fs: TouchedRepoDeps["fs"], start: string): string | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    if (fs.mtimeMs(join(dir, ".git")) !== undefined) {
      return dir;
    }
    if (dirname(dir) === dir) {
      return undefined;
    }
  }
}

// The directory to search from: the path itself when it is one, else the directory it is in.
function repoRootOf(fs: TouchedRepoDeps["fs"], path: string): string | undefined {
  return repoRootAbove(fs, fs.isDirectory(path) ? path : dirname(path));
}

// The distinct repo roots a call touched, in the order it touched them; paths outside any repo
// and paths that cannot be examined are left out.
export function createTouchedRoots({
  fs,
  log,
}: TouchedRepoDeps): (call: ToolCallInfo, directory: string) => string[] {
  return (call, directory) => {
    const roots = new Set<string>();
    for (const path of call.touchedPaths) {
      try {
        const root = repoRootOf(fs, resolve(directory, path));
        if (root !== undefined) {
          roots.add(root);
        }
      } catch (error) {
        log("warn", "touched path not examined", { path, error: String(error) });
      }
    }
    return [...roots];
  };
}

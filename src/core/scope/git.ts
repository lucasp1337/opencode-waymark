export type GitAnswer =
  | { readonly status: "found"; readonly value: string }
  | { readonly status: "absent" }
  | { readonly status: "failed"; readonly reason: string };

type GitFailure = Extract<GitAnswer, { status: "failed" }>;

interface GitExit {
  readonly status: "exited";
  readonly code: number;
  readonly stdout: string;
}

// Read-only: Waymark never writes inside a user's repository.
// "absent" is a definite answer (no repository, no origin); "failed" means git could not answer.
export interface Git {
  root(dir: string): GitAnswer;
  originUrl(root: string): GitAnswer;
}

const GIT_TIMEOUT_MS = 5000;
// `git remote get-url` exits 2 when the remote does not exist.
const NO_SUCH_REMOTE = 2;

function failed(reason: string): GitFailure {
  return { status: "failed", reason };
}

function runGit(args: readonly string[], timeoutMs: number): GitExit | GitFailure {
  try {
    // stderr must not reach the terminal: opencode's TUI owns it.
    const result = Bun.spawnSync(["git", ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      timeout: timeoutMs,
    });
    const timedOut = result.exitedDueToTimeout === true;
    if (timedOut || result.signalCode !== undefined) {
      return failed(
        timedOut
          ? `git did not answer within ${timeoutMs} ms`
          : `git was stopped by signal ${result.signalCode}`,
      );
    }
    return { status: "exited", code: result.exitCode, stdout: result.stdout.toString().trim() };
  } catch (error) {
    // Spawning throws when git is not installed or an argument is unusable.
    return failed(String(error));
  }
}

export function createProcessGit(timeoutMs: number): Git {
  return {
    root(dir) {
      const run = runGit(["-C", dir, "rev-parse", "--show-toplevel"], timeoutMs);
      if (run.status === "failed") {
        return run;
      }
      // Any non-zero exit is absent: git exits 128 outside a work tree but also on other fatal
      // errors, and the two cannot be told apart structurally.
      return run.code === 0 ? { status: "found", value: run.stdout } : { status: "absent" };
    },
    originUrl(root) {
      const run = runGit(["-C", root, "remote", "get-url", "origin"], timeoutMs);
      if (run.status === "failed") {
        return run;
      }
      if (run.code === 0) {
        return { status: "found", value: run.stdout };
      }
      return run.code === NO_SUCH_REMOTE
        ? { status: "absent" }
        : failed(`git remote get-url exited ${run.code}`);
    },
  };
}

export const processGit: Git = createProcessGit(GIT_TIMEOUT_MS);

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

// The same question as `Git.originUrl`, for hooks: the event loop is not blocked while git runs.
export type AsyncOriginUrl = (root: string) => Promise<GitAnswer>;

const GIT_TIMEOUT_MS = 5000;
// `git remote get-url` exits 2 when the remote does not exist.
const NO_SUCH_REMOTE = 2;

function failed(reason: string): GitFailure {
  return { status: "failed", reason };
}

// stderr must not reach the terminal: opencode's TUI owns it.
function spawnOptions(timeoutMs: number) {
  return { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: timeoutMs } as const;
}

interface Finished {
  // null with no signal means git ended without a status we can trust.
  readonly exitCode: number | null;
  readonly signalCode?: string | number | null | undefined;
  // Only the synchronous spawn reports a timeout; the asynchronous one shows it as a signal.
  readonly exitedDueToTimeout?: boolean | undefined;
  readonly stdout: string;
}

export function exitOf(finished: Finished, timeoutMs: number): GitExit | GitFailure {
  const timedOut = finished.exitedDueToTimeout === true;
  const signalled = finished.signalCode !== undefined && finished.signalCode !== null;
  if (timedOut || signalled) {
    return failed(
      timedOut
        ? `git did not answer within ${timeoutMs} ms`
        : `git was stopped by signal ${finished.signalCode}`,
    );
  }
  if (finished.exitCode === null) {
    return failed("git ended without an exit status");
  }
  return { status: "exited", code: finished.exitCode, stdout: finished.stdout.trim() };
}

function runGit(args: readonly string[], timeoutMs: number): GitExit | GitFailure {
  try {
    const result = Bun.spawnSync(["git", ...args], spawnOptions(timeoutMs));
    return exitOf({ ...result, stdout: result.stdout.toString() }, timeoutMs);
  } catch (error) {
    // Spawning throws when git is not installed or an argument is unusable.
    return failed(String(error));
  }
}

async function runGitAsync(
  args: readonly string[],
  timeoutMs: number,
): Promise<GitExit | GitFailure> {
  try {
    const child = Bun.spawn(["git", ...args], spawnOptions(timeoutMs));
    const [stdout] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return exitOf(
      {
        exitCode: child.exitCode,
        signalCode: child.signalCode,
        stdout,
      },
      timeoutMs,
    );
  } catch (error) {
    return failed(String(error));
  }
}

function originAnswer(run: GitExit | GitFailure): GitAnswer {
  if (run.status === "failed") {
    return run;
  }
  if (run.code === 0) {
    return { status: "found", value: run.stdout };
  }
  return run.code === NO_SUCH_REMOTE
    ? { status: "absent" }
    : failed(`git remote get-url exited ${run.code}`);
}

const originArgs = (root: string): string[] => ["-C", root, "remote", "get-url", "origin"];

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
    originUrl: (root) => originAnswer(runGit(originArgs(root), timeoutMs)),
  };
}

export function createProcessOriginUrl(timeoutMs: number): AsyncOriginUrl {
  return async (root) => originAnswer(await runGitAsync(originArgs(root), timeoutMs));
}

export const processGit: Git = createProcessGit(GIT_TIMEOUT_MS);
export const processOriginUrl: AsyncOriginUrl = createProcessOriginUrl(GIT_TIMEOUT_MS);

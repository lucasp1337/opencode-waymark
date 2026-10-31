import { ulid } from "ulid";
import { err, type Result } from "../model/result";
import type { FileSystem } from "../store/fs";

export interface LockTiming {
  readonly nowMs: () => number;
  readonly sleepMs: (ms: number) => Promise<void>;
  readonly retryMs: number;
  // How long to wait for a lock held by someone else before giving up.
  readonly timeoutMs: number;
  // A lock older than this belongs to a process that died holding it.
  readonly staleMs: number;
  // Differs between every call, in this process and in others.
  readonly uniqueSuffix: () => string;
}

function sleepOnTimer(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const systemLockTiming: LockTiming = {
  nowMs: () => Date.now(),
  sleepMs: sleepOnTimer,
  retryMs: 25,
  timeoutMs: 2_000,
  staleMs: 10_000,
  uniqueSuffix: () => `${process.pid}.${ulid()}`,
};

function isStale(fs: FileSystem, lockFile: string, timing: LockTiming): boolean {
  const modified = fs.mtimeMs(lockFile);
  return modified !== undefined && timing.nowMs() - modified > timing.staleMs;
}

// Of several waiters that saw the same stale lock only one can rename it away. A waiter whose
// staleness check is outdated may rename a lock that was meanwhile taken over and recreated; it
// then puts that live lock back. What is removed is only ever Waymark's own lock file.
function takeOverStale(fs: FileSystem, lockFile: string, timing: LockTiming): void {
  const taken = `${lockFile}.${timing.uniqueSuffix()}.stale`;
  try {
    fs.move(lockFile, taken);
  } catch {
    // Another waiter renamed it first; the next attempt finds it gone or fresh.
    return;
  }
  if (!isStale(fs, taken, timing)) {
    fs.createExclusive(lockFile, "");
  }
  fs.remove(taken);
}

async function acquire(fs: FileSystem, lockFile: string, timing: LockTiming): Promise<boolean> {
  const deadline = timing.nowMs() + timing.timeoutMs;
  for (;;) {
    if (fs.createExclusive(lockFile, "")) {
      return true;
    }
    if (isStale(fs, lockFile, timing)) {
      takeOverStale(fs, lockFile, timing);
    } else if (timing.nowMs() >= deadline) {
      return false;
    } else {
      await timing.sleepMs(timing.retryMs);
    }
  }
}

// Runs `update` while holding `<file>.lock`, so read-modify-write cycles of two processes cannot
// interleave. `update` must read the registry itself, inside the lock. Fails with a message when
// the lock stays held; I/O errors from the FileSystem throw.
export async function withRegistryLock<T>(
  fs: FileSystem,
  file: string,
  timing: LockTiming,
  update: () => Result<T, string>,
): Promise<Result<T, string>> {
  const lockFile = `${file}.lock`;
  if (!(await acquire(fs, lockFile, timing))) {
    return err(`registry ${file} is being updated by another Waymark process; try again`);
  }
  try {
    return update();
  } finally {
    fs.remove(lockFile);
  }
}

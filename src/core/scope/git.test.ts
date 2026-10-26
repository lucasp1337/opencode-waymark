import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProcessGit, processGit } from "./git";

// A host no gitconfig rewrites with insteadOf, so the answer does not depend on the user's setup.
const ORIGIN = "https://git.example.test/acme/api.git";
const dirs: string[] = [];

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "waymark-git-")));
  dirs.push(dir);
  return dir;
}

function git(dir: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", dir, ...args]);
  expect(result.exitCode).toBe(0);
}

function tempRepo(origin?: string): string {
  const dir = tempDir();
  git(dir, "init", "--quiet");
  if (origin !== undefined) {
    git(dir, "remote", "add", "origin", origin);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("processGit.root", () => {
  test("finds the repository root from a subdirectory", () => {
    const repo = tempRepo();
    const sub = join(repo, "src", "deep");
    mkdirSync(sub, { recursive: true });

    expect(processGit.root(sub)).toEqual({ status: "found", value: repo });
  });

  test("reports a directory outside any repository as absent", () => {
    expect(processGit.root(tempDir())).toEqual({ status: "absent" });
  });

  test("reports a missing directory as absent", () => {
    expect(processGit.root(join(tempDir(), "missing"))).toEqual({ status: "absent" });
  });

  test("reports a directory that cannot be passed to a process as failed", () => {
    expect(processGit.root("bad\0dir").status).toBe("failed");
  });

  test("reports a git that does not answer in time as failed", () => {
    const repo = tempRepo();
    const config = join(repo, ".git", "config");
    rmSync(config);
    // Opening a pipe with no writer blocks git while it reads its config.
    expect(Bun.spawnSync(["mkfifo", config]).exitCode).toBe(0);

    expect(createProcessGit(200).root(repo)).toEqual({
      status: "failed",
      reason: "git did not answer within 200 ms",
    });
  });
});

describe("processGit.originUrl", () => {
  test("returns the url of the origin remote", () => {
    const repo = tempRepo(ORIGIN);

    expect(processGit.originUrl(repo)).toEqual({ status: "found", value: ORIGIN });
  });

  test("reports a repository without an origin remote as absent", () => {
    expect(processGit.originUrl(tempRepo())).toEqual({ status: "absent" });
  });

  test("reports a directory that cannot be passed to a process as failed", () => {
    expect(processGit.originUrl("bad\0dir").status).toBe("failed");
  });

  test("reports git failing for another reason as failed", () => {
    expect(processGit.originUrl(tempDir())).toEqual({
      status: "failed",
      reason: "git remote get-url exited 128",
    });
  });
});

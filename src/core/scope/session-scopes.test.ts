import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createFakeHost, type FakeHost } from "../../../test/fake-host";
import { useTempDirs } from "../../../test/temp-dir";
import { nodeFileSystem } from "../store/fs";
import type { Git, GitAnswer } from "./git";
import { createSessionScopes, type SessionScopes } from "./session-scopes";

const tempDir = useTempDirs();

const found = (value: string): GitAnswer => ({ status: "found", value });
const ORIGIN = found("git@github.com:acme/api.git");

interface CountingGit extends Git {
  readonly rootCalls: () => number;
}

function gitAnswering(root: GitAnswer, origin: GitAnswer = ORIGIN): CountingGit {
  let calls = 0;
  return {
    rootCalls: () => calls,
    root: () => {
      calls += 1;
      return root;
    },
    originUrl: () => origin,
  };
}

function hostWith(sessions: Record<string, string>): FakeHost {
  const host = createFakeHost();
  for (const [id, directory] of Object.entries(sessions)) {
    host.sessions.set(id, { id, directory });
  }
  return host;
}

function scopesFor(host: FakeHost, git: Git, registryFile = join(tempDir(), "registry.json")) {
  const scopes: SessionScopes = createSessionScopes({
    host,
    git,
    fs: nodeFileSystem,
    registryFile,
  });
  return scopes;
}

describe("createSessionScopes", () => {
  test("resolves the chain from the session's directory", async () => {
    const host = hostWith({ ses_a: "/work/api" });

    const chain = await scopesFor(host, gitAnswering(found("/work/api"))).chainFor("ses_a");

    expect(chain).toEqual([
      { level: "user" },
      { level: "org", id: "github.com/acme" },
      { level: "repo", id: "github.com/acme/api" },
    ]);
  });

  test("asks git once per directory", async () => {
    const host = hostWith({ ses_a: "/work/api", ses_b: "/work/api" });
    const git = gitAnswering(found("/work/api"));
    const scopes = scopesFor(host, git);

    await scopes.chainFor("ses_a");
    await scopes.chainFor("ses_b");

    expect(git.rootCalls()).toBe(1);
  });

  test("announces a new org once, also across activations", async () => {
    const registryFile = join(tempDir(), "registry.json");
    const first = hostWith({ ses_a: "/work/api" });
    const second = hostWith({ ses_a: "/work/api" });

    await scopesFor(first, gitAnswering(found("/work/api")), registryFile).chainFor("ses_a");
    await scopesFor(second, gitAnswering(found("/work/api")), registryFile).chainFor("ses_a");

    expect(first.toasts).toEqual(["waymark · new org: acme"]);
    expect(second.toasts).toEqual([]);
  });

  test("logs a git failure, degrades to the user scope and retries next time", async () => {
    const host = hostWith({ ses_a: "/work/api" });
    const git = gitAnswering({ status: "failed", reason: "git did not answer" });
    const scopes = scopesFor(host, git);

    expect(await scopes.chainFor("ses_a")).toEqual([{ level: "user" }]);
    await scopes.chainFor("ses_a");

    expect(git.rootCalls()).toBe(2);
    expect(host.logs[0]).toEqual({
      level: "warn",
      msg: "scope resolution degraded to user",
      data: { directory: "/work/api", failure: "git did not answer" },
    });
  });

  test("logs when a repo is identified by its root path instead of its origin", async () => {
    const host = hostWith({ ses_a: "/work/api" });

    await scopesFor(host, gitAnswering(found("/work/api"), found("/srv/git/api.git"))).chainFor(
      "ses_a",
    );

    expect(host.logs.map((entry) => entry.msg)).toEqual(["repo identified by its root path"]);
  });

  test("logs an unreadable org registry and does not toast", async () => {
    const host = hostWith({ ses_a: "/work/api" });
    const registryFile = join(tempDir(), "registry.json");
    nodeFileSystem.writeAtomic(registryFile, "{ not json");

    await scopesFor(host, gitAnswering(found("/work/api")), registryFile).chainFor("ses_a");

    expect(host.toasts).toEqual([]);
    expect(host.logs.map((entry) => entry.msg)).toEqual(["org not registered"]);
  });
});

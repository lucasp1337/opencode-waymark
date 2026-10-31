import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createFakeHost, type FakeHost } from "../../../test/fake-host";
import { useTempDirs } from "../../../test/temp-dir";
import { repoIdIn } from "../model/scope";
import { type FileSystem, nodeFileSystem } from "../store/fs";
import type { Git, GitAnswer } from "./git";
import { linkRepos } from "./products";
import { recordMerge, resolveOrg } from "./registry";
import { createSessionScopes, type SessionScopes } from "./session-scopes";

const tempDir = useTempDirs();

function writeRegistry(file: string, content: unknown): void {
  nodeFileSystem.writeAtomic(file, JSON.stringify(content));
}

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

  test("logs an unreadable registry for the org and the product and does not toast", async () => {
    const host = hostWith({ ses_a: "/work/api" });
    const registryFile = join(tempDir(), "registry.json");
    nodeFileSystem.writeAtomic(registryFile, "{ not json");

    await scopesFor(host, gitAnswering(found("/work/api")), registryFile).chainFor("ses_a");

    expect(host.toasts).toEqual([]);
    expect(host.logs.map((entry) => entry.msg)).toEqual([
      "org registry not applied",
      "product links not applied",
    ]);
  });

  test("an org merged into another resolves to the other", async () => {
    const registryFile = join(tempDir(), "registry.json");
    writeRegistry(registryFile, {
      orgs: { "github.com/acme": { owner: "acme" }, "github.com/umbrella": { owner: "umbrella" } },
      aliases: { "github.com/acme": "github.com/umbrella" },
    });
    const host = hostWith({ ses_a: "/work/api" });

    const chain = await scopesFor(host, gitAnswering(found("/work/api")), registryFile).chainFor(
      "ses_a",
    );

    expect(chain).toEqual([
      { level: "user" },
      { level: "org", id: "github.com/umbrella" },
      { level: "repo", id: "github.com/acme/api" },
    ]);
  });

  test("a merge recorded after the chain was cached applies to the next call", async () => {
    const registryFile = join(tempDir(), "registry.json");
    const host = hostWith({ ses_a: "/work/api" });
    const scopes = scopesFor(host, gitAnswering(found("/work/api")), registryFile);
    await scopes.chainFor("ses_a");
    await resolveOrg(nodeFileSystem, registryFile, {
      id: "github.com/umbrella",
      owner: "umbrella",
    });
    await recordMerge(nodeFileSystem, registryFile, {
      into: "github.com/umbrella",
      from: "github.com/acme",
    });

    expect(await scopes.chainFor("ses_a")).toContainEqual({
      level: "org",
      id: "github.com/umbrella",
    });
  });

  test("an org that was merged away is not announced as new", async () => {
    const registryFile = join(tempDir(), "registry.json");
    writeRegistry(registryFile, { aliases: { "github.com/acme": "github.com/umbrella" } });
    const host = hostWith({ ses_a: "/work/api" });

    await scopesFor(host, gitAnswering(found("/work/api")), registryFile).chainFor("ses_a");

    expect(host.toasts).toEqual([]);
  });

  test("a registry that cannot be read is logged and leaves the chain as git found it", async () => {
    const host = hostWith({ ses_a: "/work/api" });
    const unreadable: FileSystem = {
      ...nodeFileSystem,
      readText() {
        throw new Error("EACCES: permission denied");
      },
    };
    const scopes = createSessionScopes({
      host,
      git: gitAnswering(found("/work/api")),
      fs: unreadable,
      registryFile: join(tempDir(), "registry.json"),
    });

    const chain = await scopes.chainFor("ses_a");

    expect(chain).toContainEqual({ level: "org", id: "github.com/acme" });
    expect(host.logs).toEqual([
      {
        level: "warn",
        msg: "org registry not applied",
        data: { org: "github.com/acme", error: "Error: EACCES: permission denied" },
      },
      {
        level: "warn",
        msg: "product links not applied",
        data: { repo: "github.com/acme/api", error: "Error: EACCES: permission denied" },
      },
    ]);
  });

  test("a linked repo's chain has its product between the org and the repo", async () => {
    const registryFile = join(tempDir(), "registry.json");
    await linkRepos(nodeFileSystem, registryFile, {
      repos: ["github.com/acme/api", "github.com/acme/web"],
      product: "payments",
    });
    const host = hostWith({ ses_a: "/work/api" });

    const chain = await scopesFor(host, gitAnswering(found("/work/api")), registryFile).chainFor(
      "ses_a",
    );

    expect(chain).toEqual([
      { level: "user" },
      { level: "org", id: "github.com/acme" },
      { level: "product", id: "payments" },
      { level: "repo", id: "github.com/acme/api" },
    ]);
  });

  test("a repo without an origin can be linked too", async () => {
    const registryFile = join(tempDir(), "registry.json");
    const host = hostWith({ ses_a: "/work/api" });
    const scopes = scopesFor(
      host,
      gitAnswering(found("/work/api"), { status: "absent" }),
      registryFile,
    );
    const repoId = repoIdIn(await scopes.chainFor("ses_a"));
    if (repoId === undefined) {
      throw new Error("a repo without an origin must still have a repo scope");
    }
    await linkRepos(nodeFileSystem, registryFile, { repos: [repoId], product: "notes" });

    expect(await scopes.chainFor("ses_a")).toEqual([
      { level: "user" },
      { level: "product", id: "notes" },
      { level: "repo", id: repoId },
    ]);
  });

  test("a link recorded after the chain was cached applies to the next call", async () => {
    const registryFile = join(tempDir(), "registry.json");
    const host = hostWith({ ses_a: "/work/api" });
    const scopes = scopesFor(host, gitAnswering(found("/work/api")), registryFile);
    await scopes.chainFor("ses_a");
    await linkRepos(nodeFileSystem, registryFile, {
      repos: ["github.com/acme/api"],
      product: "payments",
    });

    expect(await scopes.chainFor("ses_a")).toContainEqual({ level: "product", id: "payments" });
  });

  test("a session outside any repo has no product to look up", async () => {
    const host = hostWith({ ses_a: "/tmp" });

    const chain = await scopesFor(host, gitAnswering({ status: "absent" })).chainFor("ses_a");

    expect(chain).toEqual([{ level: "user" }]);
    expect(host.logs).toEqual([]);
  });
});

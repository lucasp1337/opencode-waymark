import { describe, expect, test } from "bun:test";
import { resolveScopes } from "./chain";
import type { Git, GitAnswer } from "./git";

const ABSENT: GitAnswer = { status: "absent" };

function found(value: string): GitAnswer {
  return { status: "found", value };
}

function failed(reason: string): GitAnswer {
  return { status: "failed", reason };
}

function gitWith(root: GitAnswer, origin: GitAnswer = ABSENT): Git {
  return { root: () => root, originUrl: () => origin };
}

function repoIdIn(git: Git): string | undefined {
  const repo = resolveScopes("/any", git).chain.at(-1);
  return repo?.level === "repo" ? repo.id : undefined;
}

describe("resolveScopes", () => {
  test("outside a repository the chain is the user scope alone", () => {
    expect(resolveScopes("/tmp/notes", gitWith(ABSENT))).toStrictEqual({
      chain: [{ level: "user" }],
    });
  });

  test("when git fails to find the root the chain is the user scope plus the failure", () => {
    expect(resolveScopes("/work/api", gitWith(failed("git not installed")))).toStrictEqual({
      chain: [{ level: "user" }],
      failure: "git not installed",
    });
  });

  test("a repository with an origin gets its org and repo scopes", () => {
    const git = gitWith(found("/work/api"), found("git@github.com:Acme/api.git"));

    expect(resolveScopes("/work/api", git)).toStrictEqual({
      chain: [
        { level: "user" },
        { level: "org", id: "github.com/acme" },
        { level: "repo", id: "github.com/acme/api" },
      ],
      org: { id: "github.com/acme", owner: "acme" },
    });
  });

  test("a gitlab subgroup is the org owner", () => {
    const git = gitWith(found("/work/x"), found("https://gitlab.com/group/sub/repo.git"));

    expect(resolveScopes("/work/x", git).org).toEqual({
      id: "gitlab.com/group/sub",
      owner: "group/sub",
    });
  });

  test("the origin is read from the repository root, not from the given directory", () => {
    const git: Git = {
      root: (dir) => (dir === "/work/api/src" ? found("/work/api") : ABSENT),
      originUrl: (root) => (root === "/work/api" ? found("https://github.com/acme/api") : ABSENT),
    };

    expect(resolveScopes("/work/api/src", git).org).toEqual({
      id: "github.com/acme",
      owner: "acme",
    });
  });

  test("a repository without an origin gets a local repo scope and no org or note", () => {
    expect(resolveScopes("/work/scratch", gitWith(found("/work/scratch")))).toStrictEqual({
      chain: [{ level: "user" }, { level: "repo", id: "local/bc7e00170321a9c9" }],
    });
  });

  test("an origin that is not a host/owner/name address falls back to the local repo scope", () => {
    const git = gitWith(found("/work/scratch"), found("/srv/git/x.git"));

    expect(resolveScopes("/work/scratch", git)).toStrictEqual({
      chain: [{ level: "user" }, { level: "repo", id: "local/bc7e00170321a9c9" }],
      fallback: "origin is not a host/owner/name address; using the local repo id",
    });
  });

  test("when git fails to read the origin no repo scope is guessed", () => {
    const git = gitWith(found("/work/api"), failed("git remote get-url exited 128"));

    expect(resolveScopes("/work/api", git)).toStrictEqual({
      chain: [{ level: "user" }],
      failure: "git remote get-url exited 128",
    });
  });

  test("the local repo id is stable for a root and differs between roots", () => {
    expect(repoIdIn(gitWith(found("/work/a")))).toBe(repoIdIn(gitWith(found("/work/a"))));
    expect(repoIdIn(gitWith(found("/work/a")))).not.toBe(repoIdIn(gitWith(found("/work/b"))));
  });
});

import { describe, expect, test } from "bun:test";
import { ok } from "../model/result";
import { orgIdOf, parseRemote, type RemoteIdentity, repoIdOf } from "./remote";

const acmeApi: RemoteIdentity = { host: "github.com", owner: "acme", name: "api" };

describe("parseRemote", () => {
  test.each<[string, string, RemoteIdentity]>([
    ["https without .git", "https://github.com/acme/api", acmeApi],
    ["https with user and token", "https://user:ghp_token@github.com/acme/api.git", acmeApi],
    ["http", "http://github.com/acme/api.git", acmeApi],
    ["ssh with a port", "ssh://git@github.com:2222/acme/api.git", acmeApi],
    ["git protocol", "git://github.com/acme/api.git", acmeApi],
    ["git+ssh", "git+ssh://git@github.com/acme/api.git", acmeApi],
    ["scp-like", "git@github.com:acme/api.git", acmeApi],
    ["scp-like without a user", "github.com:acme/api.git", acmeApi],
    ["a trailing slash", "https://github.com/acme/api/", acmeApi],
    ["a trailing .git and slash", "https://github.com/acme/api.git/", acmeApi],
    ["uppercase scheme, host, owner and name", "HTTPS://GitHub.COM/Acme/API.GIT", acmeApi],
    [
      "a gitlab subgroup over https",
      "https://gitlab.com/group/sub/repo.git",
      { host: "gitlab.com", owner: "group/sub", name: "repo" },
    ],
    [
      "a gitlab subgroup over scp-like",
      "git@gitlab.com:group/sub/repo.git",
      { host: "gitlab.com", owner: "group/sub", name: "repo" },
    ],
  ])("parses %s", (_case, url, expected) => {
    expect(parseRemote(url)).toEqual(ok(expected));
  });

  test.each([
    ["an empty string", ""],
    ["an absolute local path", "/home/me/repo"],
    ["a relative local path", "../repo"],
    ["a file url", "file:///srv/git/repo.git"],
    ["a windows drive path", "C:foo/bar"],
    ["a windows drive path with a slash", "C:/foo/bar"],
    ["a missing owner", "https://github.com/api.git"],
    ["a missing path", "https://github.com/"],
    ["a name that is only .git", "https://github.com/acme/.git"],
    ["a parent-directory segment", "https://github.com/../api"],
    ["a parent-directory segment over scp-like", "git@github.com:acme/../api"],
    ["an empty segment", "https://github.com/acme//api"],
    ["characters that are not a plain name", "https://github.com/acme/my repo"],
    ["an unsupported scheme", "ftp://github.com/acme/api"],
  ])("rejects %s", (_case, url) => {
    expect(parseRemote(url).ok).toBe(false);
  });

  test("a rejection does not echo the remote, which may carry credentials", () => {
    const result = parseRemote("https://user:s3cret@github.com/");

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).not.toContain("s3cret");
  });
});

describe("repoIdOf and orgIdOf", () => {
  test("join host with owner and name, or with owner only", () => {
    const identity = { host: "gitlab.com", owner: "group/sub", name: "repo" };

    expect(repoIdOf(identity)).toBe("gitlab.com/group/sub/repo");
    expect(orgIdOf(identity)).toBe("gitlab.com/group/sub");
  });
});

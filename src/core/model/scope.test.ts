import { describe, expect, test } from "bun:test";
import {
  isSafeScopeId,
  isScopeLevel,
  parseScopeKey,
  type ScopeChain,
  scopeAt,
  scopeKey,
} from "./scope";

describe("scopeKey", () => {
  test("renders user without an id and other levels as level:id", () => {
    expect(scopeKey({ level: "user" })).toBe("user");
    expect(scopeKey({ level: "repo", id: "github.com/acme/api" })).toBe("repo:github.com/acme/api");
  });
});

describe("parseScopeKey", () => {
  test.each(["user", "org:github.com/acme", "product:payments", "repo:local/ab12"])(
    "round-trips %s",
    (key) => {
      const parsed = parseScopeKey(key);
      expect(parsed.ok && scopeKey(parsed.value)).toBe(key);
    },
  );

  test.each([
    ["an unknown level", "team:x"],
    ["a level without id", "repo"],
    ["an empty id", "repo:"],
    ["an id on user", "user:me"],
    ["an empty key", ""],
    ["a parent-directory segment", "repo:../../etc"],
    ["a line break", "repo:a\nb"],
    ["an empty segment", "org:github.com//acme"],
  ])("rejects %s", (_case, key) => {
    expect(parseScopeKey(key).ok).toBe(false);
  });
});

describe("scopeAt", () => {
  test("finds the scope of a level in the chain, or nothing", () => {
    const chain: ScopeChain = [{ level: "user" }, { level: "repo", id: "github.com/acme/api" }];

    expect(scopeAt(chain, "repo")).toEqual({ level: "repo", id: "github.com/acme/api" });
    expect(scopeAt(chain, "org")).toBeUndefined();
  });
});

describe("isScopeLevel", () => {
  test.each(["user", "org", "product", "repo"])("accepts %s", (level) => {
    expect(isScopeLevel(level)).toBe(true);
  });

  test("rejects anything else", () => {
    expect(isScopeLevel("team")).toBe(false);
  });
});

describe("isSafeScopeId", () => {
  test("accepts nested plain segments", () => {
    expect(isSafeScopeId("gitlab.com/group/sub_1/repo-name")).toBe(true);
  });

  test("rejects a segment that would climb out of the data root", () => {
    expect(isSafeScopeId("github.com/../x")).toBe(false);
  });
});

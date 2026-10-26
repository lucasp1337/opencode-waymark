import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { memoryId } from "../../../test/memory-id";
import type { ScopeRef } from "../model/scope";
import { dataRoot, memoryPath, scopeDir, scopeRoots, UnsafeScopeIdError } from "./layout";

const ROOT = "/data/waymark";
const ID = memoryId("01JB8Z6Q4R3M2N1P0V9W8X7Y6Z");

describe("dataRoot", () => {
  test("uses XDG_DATA_HOME when it is set", () => {
    expect(dataRoot({ XDG_DATA_HOME: "/xdg" }, "/home/ada")).toBe("/xdg/waymark");
  });

  test.each([
    ["unset", {}],
    ["empty", { XDG_DATA_HOME: "" }],
    ["relative", { XDG_DATA_HOME: "data/share" }],
  ])("falls back to the home directory when XDG_DATA_HOME is %s", (_case, env) => {
    expect(dataRoot(env, "/home/ada")).toBe("/home/ada/.local/share/waymark");
  });
});

describe("scopeDir", () => {
  test.each<[string, ScopeRef, string]>([
    ["user", { level: "user" }, "user"],
    ["org", { level: "org", id: "github.com/acme" }, "orgs/github.com/acme"],
    ["product", { level: "product", id: "payments" }, "products/payments"],
    ["repo", { level: "repo", id: "github.com/acme/api" }, "repos/github.com/acme/api"],
  ])("places a %s scope in its own directory, nesting slashes in the id", (_level, scope, dir) => {
    expect(scopeDir(ROOT, scope)).toBe(join(ROOT, dir));
  });
});

describe("unsafe scope ids", () => {
  test.each(["../escape", "a/../b", "/absolute", "a//b", "with space", ".."])(
    "scopeDir refuses the repo id %p so a path never leaves the data root",
    (id) => {
      expect(() => scopeDir(ROOT, { level: "repo", id })).toThrow(UnsafeScopeIdError);
    },
  );

  test.each(["org", "product"] as const)("scopeDir refuses an unsafe %s id", (level) => {
    expect(() => scopeDir(ROOT, { level, id: "../escape" })).toThrow(UnsafeScopeIdError);
  });

  test("memoryPath refuses an unsafe id and names it in the error", () => {
    const memory = { scope: { level: "repo", id: "../escape" }, kind: "fact", id: ID } as const;

    expect(() => memoryPath(ROOT, memory)).toThrow('unsafe scope id "../escape"');
  });
});

describe("memoryPath", () => {
  test("files a memory under its scope, kind and id", () => {
    const memory = {
      scope: { level: "repo", id: "github.com/acme/api" },
      kind: "gotcha",
      id: ID,
    } as const;

    expect(memoryPath(ROOT, memory)).toBe(
      join(ROOT, "repos/github.com/acme/api/gotcha/01JB8Z6Q4R3M2N1P0V9W8X7Y6Z.md"),
    );
  });
});

describe("scopeRoots", () => {
  test("lists the four scope directories and nothing else under the root", () => {
    expect(scopeRoots(ROOT)).toEqual([
      join(ROOT, "user"),
      join(ROOT, "orgs"),
      join(ROOT, "products"),
      join(ROOT, "repos"),
    ]);
  });
});

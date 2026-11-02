import { describe, expect, test } from "bun:test";
import { err, ok } from "../../model/result";
import { checkRepoTargets } from "./repo-targets";

const PRODUCT = { level: "product", id: "payments" } as const;
const members = (repos: readonly string[]) => ({ productRepos: () => ok(repos) });

describe("checkRepoTargets", () => {
  test("accepts a memory that targets no repo at any scope", () => {
    expect(checkRepoTargets(members([]), { level: "user" }, { paths: ["src/**"] })).toEqual(
      ok(undefined),
    );
  });

  test("refuses a repo-scope memory", () => {
    const result = checkRepoTargets(
      members(["x/a"]),
      { level: "repo", id: "x/a" },
      { repos: ["x/a"] },
    );

    expect(result.ok).toBe(false);
  });

  test("accepts targets that are all members", () => {
    expect(checkRepoTargets(members(["x/a", "x/b"]), PRODUCT, { repos: ["x/a", "x/b"] })).toEqual(
      ok(undefined),
    );
  });

  test("names the unknown targets and the members", () => {
    expect(checkRepoTargets(members(["x/a"]), PRODUCT, { repos: ["x/a", "x/c"] })).toEqual(
      err("triggers.repos has x/c, not in product payments; its repos are: x/a"),
    );
  });

  test("says none when the product has no repos", () => {
    expect(checkRepoTargets(members([]), PRODUCT, { repos: ["x/c"] })).toEqual(
      err("triggers.repos has x/c, not in product payments; its repos are: none"),
    );
  });

  test("refuses, with the reason, when the registry cannot be read", () => {
    const result = checkRepoTargets({ productRepos: () => err("bad json") }, PRODUCT, {
      repos: ["x/a"],
    });

    expect(result).toEqual(err("the repos of product payments could not be read (bad json)"));
  });
});

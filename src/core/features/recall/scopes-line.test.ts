import { describe, expect, test } from "bun:test";
import type { ScopeChain } from "../../model/scope";
import { scopesLine } from "./scopes-line";

const WITH_PRODUCT: ScopeChain = [
  { level: "user" },
  { level: "product", id: "shop" },
  { level: "repo", id: "x/r0" },
];

function repos(count: number): string[] {
  return Array.from({ length: count }, (_, n) => `x/r${n}`);
}

describe("scopesLine", () => {
  test("lists the chain broadest first", () => {
    expect(scopesLine([{ level: "user" }, { level: "repo", id: "x/r0" }], [])).toBe(
      "Scopes here: user · repo:x/r0",
    );
  });

  test("lists a single product repo", () => {
    expect(scopesLine(WITH_PRODUCT, ["x/r0"])).toBe(
      "Scopes here: user · product:shop (x/r0) · repo:x/r0",
    );
  });

  test("lists exactly five product repos without a remainder", () => {
    expect(scopesLine(WITH_PRODUCT, repos(5))).toContain("x/r3, x/r4) ·");
  });

  test("counts the sixth product repo instead of listing it", () => {
    const line = scopesLine(WITH_PRODUCT, repos(6));

    expect(line).toContain("x/r4, +1 more) ·");
    expect(line).not.toContain("x/r5");
  });

  test("names the product alone when it has no repos", () => {
    expect(scopesLine(WITH_PRODUCT, [])).toBe("Scopes here: user · product:shop · repo:x/r0");
  });
});

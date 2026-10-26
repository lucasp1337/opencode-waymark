import { describe, expect, test } from "bun:test";
import { summarize } from "./summarize";

describe("summarize", () => {
  test("keeps primitives and turns null and undefined into null", () => {
    expect(summarize("a")).toBe("a");
    expect(summarize(3)).toBe(3);
    expect(summarize(false)).toBe(false);
    expect(summarize(null)).toBeNull();
    expect(summarize(undefined)).toBeNull();
  });

  test("truncates long strings and reports their length", () => {
    expect(summarize("x".repeat(250))).toBe(`${"x".repeat(200)}…(250)`);
  });

  test("replaces functions by their type name", () => {
    expect(summarize(() => 1)).toBe("function");
  });

  test("expands nested objects and arrays up to the depth limit", () => {
    const value = { a: { b: { c: 1 } }, list: [1, [2]] };

    expect(summarize(value)).toEqual({ a: { b: "object" }, list: [1, "array(1)"] });
  });

  test("honours a custom depth", () => {
    expect(summarize({ a: { b: { c: 1 } } }, 3)).toEqual({ a: { b: { c: 1 } } });
  });
});

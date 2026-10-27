import { describe, expect, test } from "bun:test";
import { isAlwaysOn, isKind, KINDS, kindsRequiring } from "./kind";

describe("isAlwaysOn", () => {
  test("is true for rules and preferences only", () => {
    expect(KINDS.filter(isAlwaysOn)).toEqual(["rule", "preference"]);
  });
});

describe("isKind", () => {
  test("accepts every kind and nothing else", () => {
    expect(KINDS.every(isKind)).toBe(true);
    expect(isKind("note")).toBe(false);
  });
});

describe("kindsRequiring", () => {
  test("lists the kinds that need a field", () => {
    expect(kindsRequiring("why")).toEqual(["rule", "decision"]);
    expect(kindsRequiring("triggers")).toEqual(["gotcha"]);
    expect(kindsRequiring("locator")).toEqual(["reference"]);
  });
});

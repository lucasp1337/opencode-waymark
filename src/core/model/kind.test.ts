import { describe, expect, test } from "bun:test";
import { isAlwaysOn, isIndexed, isKind, KINDS, kindsRequiring } from "./kind";

describe("isAlwaysOn", () => {
  test("is true for rules and preferences only", () => {
    expect(KINDS.filter(isAlwaysOn)).toEqual(["rule", "preference"]);
  });
});

describe("isIndexed", () => {
  test("is true for facts and decisions only", () => {
    expect(KINDS.filter(isIndexed)).toEqual(["fact", "decision"]);
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

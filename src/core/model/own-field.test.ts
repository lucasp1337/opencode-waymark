import { describe, expect, test } from "bun:test";
import { ownField } from "./own-field";

describe("ownField", () => {
  test("reads an own property", () => {
    expect(ownField({ a: 1 }, "a")).toBe(1);
  });

  test("ignores inherited properties", () => {
    expect(ownField({}, "toString")).toBeUndefined();
  });

  test("returns undefined for non-objects", () => {
    expect(ownField("text", "length")).toBeUndefined();
    expect(ownField(null, "a")).toBeUndefined();
  });
});

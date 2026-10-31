import { describe, expect, test } from "bun:test";
import { absoluteOr } from "./xdg";

describe("absoluteOr", () => {
  test("keeps an absolute value", () => {
    expect(absoluteOr("/state", "/fallback")).toBe("/state");
  });

  test("falls back when the value is unset", () => {
    expect(absoluteOr(undefined, "/fallback")).toBe("/fallback");
  });

  test("falls back when the value is empty", () => {
    expect(absoluteOr("", "/fallback")).toBe("/fallback");
  });

  test("falls back when the value is relative", () => {
    expect(absoluteOr("state", "/fallback")).toBe("/fallback");
  });
});

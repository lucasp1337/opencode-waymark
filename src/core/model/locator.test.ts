import { describe, expect, test } from "bun:test";
import { MAX_LOCATOR_LENGTH, parseLocator } from "./locator";
import type { Result } from "./result";

// Widens the branded value so plain strings can be compared against it.
function outcome(result: Result<string, string>): Result<string, string> {
  return result;
}

describe("parseLocator", () => {
  test.each([
    ["a URL", "https://wiki.example.com/deploy"],
    ["a path", "docs/release.md"],
    ["a ticket key", "PAY-1234"],
    ["any other text, uninterpreted", "the red binder"],
  ])("accepts %s", (_case, text) => {
    expect(outcome(parseLocator(text))).toEqual({ ok: true, value: text });
  });

  test("trims surrounding whitespace", () => {
    expect(outcome(parseLocator("  PAY-1  "))).toEqual({ ok: true, value: "PAY-1" });
  });

  test.each([
    ["empty", "", "locator must be a non-empty string"],
    ["blank", "   ", "locator must be a non-empty string"],
    ["not a string", 7, "locator must be a non-empty string"],
    ["multi-line", "a\nb", "locator must be a single line"],
    [
      "too long",
      "x".repeat(MAX_LOCATOR_LENGTH + 1),
      `locator must be at most ${MAX_LOCATOR_LENGTH} characters`,
    ],
  ])("rejects a locator that is %s", (_case, value, problem) => {
    expect(outcome(parseLocator(value))).toEqual({ ok: false, error: problem });
  });

  test("accepts a locator of exactly the maximum length", () => {
    expect(parseLocator("x".repeat(MAX_LOCATOR_LENGTH)).ok).toBe(true);
  });
});

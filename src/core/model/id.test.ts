import { describe, expect, test } from "bun:test";
import { isMemoryId } from "./id";

describe("isMemoryId", () => {
  test("accepts a ULID", () => {
    expect(isMemoryId("01JB8Z6Q4R3M2N1P0V9W8X7Y6Z")).toBe(true);
  });

  test.each([
    ["too short", "01JB8Z6Q4R3M2N1P0V9W8X7Y6"],
    ["lowercase", "01jb8z6q4r3m2n1p0v9w8x7y6z"],
    ["excluded letters", "01JB8Z6Q4R3M2N1P0V9W8X7YIU"],
    ["not a string", 7],
  ])("rejects %s", (_case, value) => {
    expect(isMemoryId(value)).toBe(false);
  });
});

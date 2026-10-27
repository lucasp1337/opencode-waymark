import { describe, expect, test } from "bun:test";
import { isAgentNameList } from "./agent-names";

describe("isAgentNameList", () => {
  test("accepts a list of non-empty strings, including the empty list", () => {
    expect(isAgentNameList(["review", "build"])).toBe(true);
    expect(isAgentNameList([])).toBe(true);
  });

  test("rejects anything else", () => {
    expect(isAgentNameList("review")).toBe(false);
    expect(isAgentNameList(["review", 3])).toBe(false);
    expect(isAgentNameList([""])).toBe(false);
    expect(isAgentNameList(undefined)).toBe(false);
  });
});

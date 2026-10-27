import { describe, expect, test } from "bun:test";
import { parseOptions } from "./options";

describe("parseOptions", () => {
  test("no options means no subagents", () => {
    expect(parseOptions(undefined)).toEqual({ options: { subagents: [] }, problems: [] });
  });

  test("reads a list of subagent names", () => {
    expect(parseOptions({ subagents: ["reviewer", "planner"] })).toEqual({
      options: { subagents: ["reviewer", "planner"] },
      problems: [],
    });
  });

  test("ignores a malformed list and says so", () => {
    expect(parseOptions({ subagents: ["reviewer", 3] })).toEqual({
      options: { subagents: [] },
      problems: ['option "subagents" must be a list of agent names; ignored'],
    });
  });

  test("ignores a single name that is not a list", () => {
    expect(parseOptions({ subagents: "reviewer" }).problems).toHaveLength(1);
  });
});

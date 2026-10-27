import { describe, expect, test } from "bun:test";
import { appendText, canAppend } from "./tool-output";

describe("canAppend", () => {
  test("accepts a built-in or plugin tool output with a text output", () => {
    expect(canAppend({ title: "", output: "done", metadata: {} })).toBe(true);
  });

  test("accepts an MCP result with a content list", () => {
    expect(canAppend({ content: [{ type: "text", text: "hi" }] })).toBe(true);
  });

  test("rejects a missing output, as for a failed user-started subtask", () => {
    expect(canAppend(undefined)).toBe(false);
  });

  test("rejects an object with neither text output nor content list", () => {
    expect(canAppend({ output: 3 })).toBe(false);
  });
});

describe("appendText", () => {
  test("appends to a text output on a new line", () => {
    const output = { title: "", output: "done", metadata: {} };

    appendText(output, "waymark · gotcha · x");

    expect(output.output).toBe("done\nwaymark · gotcha · x");
  });

  test("adds a text item to an MCP content list", () => {
    const output = { content: [{ type: "text", text: "hi" }] };

    appendText(output, "waymark · gotcha · x");

    expect(output.content).toEqual([
      { type: "text", text: "hi" },
      { type: "text", text: "waymark · gotcha · x" },
    ]);
  });

  test("leaves an unusable output alone", () => {
    expect(() => appendText(undefined, "x")).not.toThrow();
  });
});

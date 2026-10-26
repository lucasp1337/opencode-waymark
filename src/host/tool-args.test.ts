import { describe, expect, test } from "bun:test";
import { commandOf, touchedPaths } from "./tool-args";

describe("touchedPaths", () => {
  test("returns filePath and path when both are strings", () => {
    expect(touchedPaths({ filePath: "/a.ts", path: "/src" })).toEqual(["/a.ts", "/src"]);
  });

  test("ignores missing and non-string fields", () => {
    expect(touchedPaths({ filePath: 3, other: "/x" })).toEqual([]);
  });

  test("returns nothing for non-object args", () => {
    expect(touchedPaths(null)).toEqual([]);
    expect(touchedPaths("/a.ts")).toEqual([]);
  });
});

describe("commandOf", () => {
  test("returns the command string", () => {
    expect(commandOf({ command: "ls -la" })).toBe("ls -la");
  });

  test("returns undefined when there is no string command", () => {
    expect(commandOf({ command: 1 })).toBeUndefined();
    expect(commandOf(undefined)).toBeUndefined();
  });
});

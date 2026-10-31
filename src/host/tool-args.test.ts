import { describe, expect, test } from "bun:test";
import { commandOf, touchedPaths } from "./tool-args";

describe("touchedPaths", () => {
  test("returns filePath and path when both are strings", () => {
    expect(touchedPaths({ filePath: "/a.ts", path: "/src" })).toEqual(["/a.ts", "/src"]);
  });

  test("ignores missing and non-string fields", () => {
    expect(touchedPaths({ filePath: 3, other: "/x" })).toEqual([]);
  });

  test("returns the bash workdir", () => {
    expect(touchedPaths({ command: "ls", workdir: "/other/repo" })).toEqual(["/other/repo"]);
  });

  test("ignores a workdir that is not a string", () => {
    expect(touchedPaths({ command: "ls", workdir: 7 })).toEqual([]);
  });

  test("returns every path named by an apply_patch header", () => {
    const patchText = [
      "*** Begin Patch",
      "*** Add File: new.ts",
      "+export const a = 1;",
      "*** Update File: src/old.ts",
      "*** Move to: src/moved.ts",
      "@@",
      "-a",
      "+b",
      "*** Delete File: /abs/gone.ts",
      "*** End Patch",
    ].join("\n");
    expect(touchedPaths({ patchText })).toEqual([
      "new.ts",
      "src/old.ts",
      "src/moved.ts",
      "/abs/gone.ts",
    ]);
  });

  test("reads patch headers from CRLF text and trims the path", () => {
    expect(touchedPaths({ patchText: "*** Update File:   a.ts  \r\n*** End Patch" })).toEqual([
      "a.ts",
    ]);
  });

  test("does not read paths from patch body lines that only mention a header", () => {
    const patchText = "*** Update File: a.ts\n+*** Add File: b.ts\n  *** Delete File: c.ts";
    expect(touchedPaths({ patchText })).toEqual(["a.ts"]);
  });

  test("skips a patch header with no path", () => {
    expect(touchedPaths({ patchText: "*** Add File:   \n*** Move to:" })).toEqual([]);
  });

  test("ignores patchText that is not a string", () => {
    expect(touchedPaths({ patchText: ["*** Add File: a.ts"] })).toEqual([]);
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

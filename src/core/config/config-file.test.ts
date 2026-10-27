import { describe, expect, test } from "bun:test";
import { parseConfig, parseConfigValue } from "./config-file";

function problemsOf(text: string): string[] {
  const parsed = parseConfig(text);
  return parsed.ok ? [] : parsed.error;
}

describe("parseConfig", () => {
  test("accepts every field", () => {
    const text = `{
      // chosen with /memory setup
      "preset": "lean",
      "caps": { "user": 250, "repo": 700 },
      "indexLines": 25,
      "indexExit": { "sessions": 10, "days": 14 },
      "subagents": ["review", "explore"],
      "compactionSave": false,
      "toasts": false
    }`;

    expect(parseConfig(text)).toEqual({
      ok: true,
      value: {
        preset: "lean",
        caps: { user: 250, repo: 700 },
        indexLines: 25,
        indexExit: { sessions: 10, days: 14 },
        subagents: ["review", "explore"],
        compactionSave: false,
        toasts: false,
      },
    });
  });

  test("accepts an empty object", () => {
    expect(parseConfig("{}")).toEqual({ ok: true, value: {} });
  });

  test("treats empty caps and index exit as absent", () => {
    expect(parseConfig('{"caps": {}, "indexExit": {}}')).toEqual({ ok: true, value: {} });
  });

  test("rejects text that is not JSON", () => {
    expect(problemsOf("{ preset: lean }")).toEqual([expect.stringContaining("not valid JSONC")]);
  });

  test("rejects a document that is not an object", () => {
    expect(problemsOf("[1]")).toEqual(["config must be an object"]);
    expect(problemsOf("null")).toEqual(["config must be an object"]);
  });

  test("rejects an unknown preset", () => {
    expect(problemsOf('{"preset": "huge"}')).toEqual([
      "preset must be one of lean, balanced, rich",
    ]);
  });

  test("rejects caps that are not positive integers", () => {
    expect(problemsOf('{"caps": {"user": 0, "org": 1.5, "repo": "9", "product": -3}}')).toEqual([
      "caps.user must be a positive integer",
      "caps.org must be a positive integer",
      "caps.product must be a positive integer",
      "caps.repo must be a positive integer",
    ]);
  });

  test("rejects caps that are not an object", () => {
    expect(problemsOf('{"caps": 600}')).toEqual(["caps must be an object"]);
  });

  test("rejects an unknown scope in caps", () => {
    expect(problemsOf('{"caps": {"team": 100}}')).toEqual(['caps has unknown key "team"']);
  });

  test("rejects index lines that are not a positive integer", () => {
    expect(problemsOf('{"indexLines": 0}')).toEqual(["indexLines must be a positive integer"]);
    expect(problemsOf('{"indexLines": null}')).toEqual(["indexLines must be a positive integer"]);
  });

  test("rejects index exit thresholds that are not positive integers", () => {
    expect(problemsOf('{"indexExit": {"sessions": 0, "days": 2.5}}')).toEqual([
      "indexExit.sessions must be a positive integer",
      "indexExit.days must be a positive integer",
    ]);
  });

  test("rejects an unknown index exit key", () => {
    expect(problemsOf('{"indexExit": {"weeks": 2}}')).toEqual([
      'indexExit has unknown key "weeks"',
    ]);
  });

  test("rejects subagents that are not a list of names", () => {
    const message = "subagents must be a list of non-empty agent names";

    expect(problemsOf('{"subagents": "review"}')).toEqual([message]);
    expect(problemsOf('{"subagents": ["review", 3]}')).toEqual([message]);
    expect(problemsOf('{"subagents": [""]}')).toEqual([message]);
  });

  test("rejects flags that are not booleans", () => {
    expect(problemsOf('{"compactionSave": "yes", "toasts": 1}')).toEqual([
      "compactionSave must be true or false",
      "toasts must be true or false",
    ]);
  });

  test("rejects unknown keys", () => {
    expect(problemsOf('{"theme": "dark"}')).toEqual(['unknown key "theme"']);
  });

  test("reports every problem at once", () => {
    expect(problemsOf('{"preset": "huge", "indexLines": -1, "theme": 1}')).toEqual([
      'unknown key "theme"',
      "preset must be one of lean, balanced, rich",
      "indexLines must be a positive integer",
    ]);
  });
});

describe("parseConfigValue", () => {
  test("ignores keys whose value is undefined", () => {
    expect(parseConfigValue({ preset: undefined, toasts: false })).toEqual({
      ok: true,
      value: { toasts: false },
    });
  });
});

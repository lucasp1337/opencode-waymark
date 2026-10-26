import { describe, expect, test } from "bun:test";
import { validContent } from "../../../test/valid-content";
import type { MemoryContent } from "./memory";
import type { Result } from "./result";
import { applyPatch, parseContent, parsePatch } from "./validate";

const fact = {
  kind: "fact",
  title: "Staging resets nightly",
  body: "All data is wiped at 02:00.",
} as const;

// Widens the branded result so plain object literals can be compared against it.
function outcome(result: Result<MemoryContent, string[]>): MemoryContent | string[] {
  return result.ok ? result.value : result.error;
}

function problems(input: unknown): string[] {
  const result = parseContent(input);
  return result.ok ? [] : result.error;
}

describe("parseContent", () => {
  test("accepts a fact with only kind, title and body", () => {
    expect(outcome(parseContent(fact))).toEqual(fact);
  });

  test("trims the title and why but keeps the body as written", () => {
    const input = { kind: "rule", title: "  Use UTC  ", why: " logs ", body: " x " };

    expect(outcome(parseContent(input))).toEqual({
      kind: "rule",
      title: "Use UTC",
      body: " x ",
      why: "logs",
    });
  });

  test("requires why for rules", () => {
    expect(problems({ ...fact, kind: "rule" })).toEqual(["rule needs why: the reason it holds"]);
  });

  test("requires why for decisions", () => {
    expect(problems({ ...fact, kind: "decision" })).toEqual([
      "decision needs why: the reason it holds",
    ]);
  });

  test("requires triggers for gotchas", () => {
    expect(problems({ ...fact, kind: "gotcha" })).toEqual([
      "gotcha needs triggers (paths, commands, tools, keywords)",
    ]);
  });

  test("accepts a gotcha with one trigger list", () => {
    expect(problems({ ...fact, kind: "gotcha", triggers: { commands: ["make deploy"] } })).toEqual(
      [],
    );
  });

  test("requires a locator in the body of a reference", () => {
    expect(problems({ ...fact, kind: "reference" })).toEqual([
      "reference needs a locator in the body (URL, path or ticket key)",
    ]);
  });

  test("accepts a reference whose body has a URL", () => {
    expect(
      problems({ ...fact, kind: "reference", body: "https://runbooks.example.com/x" }),
    ).toEqual([]);
  });

  test("rejects an unknown kind and names the valid ones", () => {
    expect(problems({ ...fact, kind: "note" })).toEqual([
      "kind must be one of rule, preference, fact, decision, gotcha, reference",
    ]);
  });

  test("rejects an empty title", () => {
    expect(problems({ ...fact, title: "   " })).toEqual(["title must be a non-empty string"]);
  });

  test("rejects a multi-line title", () => {
    expect(problems({ ...fact, title: "one\ntwo" })).toEqual(["title must be a single line"]);
  });

  test("reports every field problem at once", () => {
    expect(problems({ kind: "x", title: 3, body: null, why: "" })).toEqual([
      "kind must be one of rule, preference, fact, decision, gotcha, reference",
      "title must be a non-empty string",
      "body must be a string",
      "why must be a non-empty string",
    ]);
  });

  test("rejects input that is not an object", () => {
    expect(problems("fact")).toEqual(["input must be an object"]);
  });
});

describe("triggers", () => {
  const gotcha = (triggers: unknown) => problems({ ...fact, kind: "gotcha", triggers });

  test("trims entries and keeps only the lists given", () => {
    const result = parseContent({
      ...fact,
      kind: "gotcha",
      triggers: { paths: [" src/**/*.sql "], keywords: ["migration"] },
    });

    expect(result.ok && result.value.triggers).toEqual({
      paths: ["src/**/*.sql"],
      keywords: ["migration"],
    });
  });

  test("needs at least one list", () => {
    expect(gotcha({})).toEqual(["triggers needs one of paths, commands, tools, keywords"]);
  });

  test("rejects a key that is not a trigger list", () => {
    expect(gotcha({ paths: ["a"], tool: ["x"] })).toEqual([
      "triggers.tool is not one of paths, commands, tools, keywords",
    ]);
  });

  test("rejects an empty list", () => {
    expect(gotcha({ tools: [] })).toEqual(["triggers.tools must be a non-empty list of strings"]);
  });

  test("rejects a list that is not a list", () => {
    expect(gotcha({ paths: "src" })).toEqual([
      "triggers.paths must be a non-empty list of strings",
    ]);
  });

  test("rejects a keyword with whitespace", () => {
    expect(gotcha({ keywords: ["two words"] })).toEqual([
      "triggers.keywords[0] is not a valid keywords entry",
    ]);
  });

  test("rejects a tool name with whitespace", () => {
    expect(gotcha({ tools: ["bash", "web fetch"] })).toEqual([
      "triggers.tools[1] is not a valid tools entry",
    ]);
  });

  test("accepts a command prefix with spaces", () => {
    expect(gotcha({ commands: ["git push --force"] })).toEqual([]);
  });

  test("rejects a blank command", () => {
    expect(gotcha({ commands: [" "] })).toEqual([
      "triggers.commands[0] is not a valid commands entry",
    ]);
  });

  test("rejects a multi-line path", () => {
    expect(gotcha({ paths: ["a\nb"] })).toEqual(["triggers.paths[0] is not a valid paths entry"]);
  });

  test("rejects non-object triggers", () => {
    expect(gotcha(["src"])).toEqual(["triggers must be an object"]);
  });
});

describe("parsePatch", () => {
  test("keeps only the content fields that are present", () => {
    expect(parsePatch({ body: "new", kind: "rule", ignored: 1 })).toEqual({
      ok: true,
      value: { body: "new" },
    });
  });

  test("accepts an empty patch", () => {
    expect(parsePatch({})).toEqual({ ok: true, value: {} });
  });

  test("rejects invalid fields", () => {
    expect(parsePatch({ title: "", triggers: {} })).toEqual({
      ok: false,
      error: [
        "title must be a non-empty string",
        "triggers needs one of paths, commands, tools, keywords",
      ],
    });
  });

  test("rejects input that is not an object", () => {
    expect(parsePatch(null)).toEqual({ ok: false, error: ["input must be an object"] });
  });
});

describe("applyPatch", () => {
  const reference = validContent({ kind: "reference", title: "Runbook", body: "See OPS-12" });

  test("merges the patch into the content", () => {
    expect(outcome(applyPatch(reference, { title: "Deploy runbook" }))).toEqual({
      kind: "reference",
      title: "Deploy runbook",
      body: "See OPS-12",
    });
  });

  test("re-checks the kind's requirements on the result", () => {
    expect(outcome(applyPatch(reference, { body: "ask around" }))).toEqual([
      "reference needs a locator in the body (URL, path or ticket key)",
    ]);
  });
});

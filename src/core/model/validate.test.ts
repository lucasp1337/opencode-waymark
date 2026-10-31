import { describe, expect, test } from "bun:test";
import { validContent } from "../../../test/valid-content";
import { MAX_HOW_TO_APPLY_LENGTH } from "./kind";
import { MAX_LOCATOR_LENGTH } from "./locator";
import type { MemoryContent } from "./memory";
import type { Result } from "./result";
import { applyPatch, parseContent, parsePatch, parseStoredContent } from "./validate";

const fact = {
  kind: "fact",
  title: "Staging resets nightly",
  body: "All data is wiped at 02:00.",
} as const;

// Widens the branded result so plain object literals can be compared against it.
function outcome(result: Result<MemoryContent, string[]>): unknown {
  return result.ok ? result.value : result.error;
}

function problems(input: unknown): string[] {
  const result = parseContent(input);
  return result.ok ? [] : result.error;
}

describe("howToApply", () => {
  const rule = { kind: "rule", title: "Use UTC", body: "x", why: "logs" } as const;

  test.each(["rule", "preference"])("is kept on a %s", (kind) => {
    const result = parseContent({ ...rule, kind, howToApply: "  In log code  " });

    expect(result.ok && result.value.howToApply).toBe("In log code");
  });

  test("is kept on a gotcha", () => {
    const result = parseContent({
      ...fact,
      kind: "gotcha",
      triggers: { tools: ["bash"] },
      howToApply: "Before deploying",
    });

    expect(result.ok && result.value.howToApply).toBe("Before deploying");
  });

  test.each(["fact", "decision", "reference"])("is refused on a %s", (kind) => {
    expect(problems({ ...rule, kind, locator: "PAY-1", howToApply: "In log code" })).toEqual([
      `${kind} cannot have howToApply (only rule, preference, gotcha)`,
    ]);
  });

  test("must be a non-empty string", () => {
    expect(problems({ ...rule, howToApply: " " })).toEqual([
      "howToApply must be a non-empty string",
    ]);
  });

  test("must be a single line", () => {
    expect(problems({ ...rule, howToApply: "a\nb" })).toEqual(["howToApply must be a single line"]);
  });

  test("must stay within the length limit", () => {
    expect(problems({ ...rule, howToApply: "x".repeat(MAX_HOW_TO_APPLY_LENGTH + 1) })).toEqual([
      `howToApply must be at most ${MAX_HOW_TO_APPLY_LENGTH} characters`,
    ]);
  });

  test("a stored fact with it still loads, without the field", () => {
    const result = parseStoredContent({ ...fact, howToApply: "In log code" });

    expect(outcome(result)).toEqual(fact);
  });

  test("a patch can add it to a rule", () => {
    const base = validContent(rule);

    const result = applyPatch(base, { howToApply: "In log code" });

    expect(result.ok && result.value.howToApply).toBe("In log code");
  });

  test("a patch cannot add it to a fact", () => {
    const result = applyPatch(validContent(fact), { howToApply: "In log code" });

    expect(result.ok ? [] : result.error).toEqual([
      "fact cannot have howToApply (only rule, preference, gotcha)",
    ]);
  });

  test("a patch parses it like new content", () => {
    expect(parsePatch({ howToApply: "" }).ok).toBe(false);
  });
});

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

  test("requires a locator on a reference", () => {
    expect(problems({ ...fact, kind: "reference" })).toEqual([
      "reference needs a locator: where it points (URL, path, ticket key)",
    ]);
  });

  test("accepts a reference with a locator and ignores what the body says", () => {
    expect(outcome(parseContent({ ...fact, kind: "reference", locator: " PAY-12 " }))).toEqual({
      ...fact,
      kind: "reference",
      locator: "PAY-12",
    });
  });

  test("does not read a locator out of the body", () => {
    expect(
      problems({ ...fact, kind: "reference", body: "https://runbooks.example.com/x" }),
    ).toEqual(["reference needs a locator: where it points (URL, path, ticket key)"]);
  });

  test.each([
    ["empty", ""],
    ["multi-line", "a\nb"],
    ["too long", "x".repeat(MAX_LOCATOR_LENGTH + 1)],
  ])("rejects a %s locator", (_case, locator) => {
    expect(problems({ ...fact, kind: "reference", locator })).toHaveLength(1);
  });

  test("drops a locator given to a kind that does not use one", () => {
    expect(outcome(parseContent({ ...fact, locator: "PAY-12" }))).toEqual(fact);
  });

  test("loads a stored reference without a locator but still enforces its other fields", () => {
    const stored = parseStoredContent({ ...fact, kind: "reference" });
    const strict = parseStoredContent({ ...fact, kind: "rule" });

    expect(stored.ok).toBe(true);
    expect(strict.ok).toBe(false);
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
  const reference = validContent({
    kind: "reference",
    title: "Runbook",
    body: "See the ticket",
    locator: "OPS-12",
  });

  test("merges the patch into the content", () => {
    expect(outcome(applyPatch(reference, { title: "Deploy runbook" }))).toEqual({
      kind: "reference",
      title: "Deploy runbook",
      body: "See the ticket",
      locator: "OPS-12",
    });
  });

  test("changes the locator of a reference", () => {
    const patch = parsePatch({ locator: "OPS-13" });

    expect(patch.ok && outcome(applyPatch(reference, patch.value))).toMatchObject({
      locator: "OPS-13",
    });
  });

  test("asks a legacy reference without a locator to gain one when it is changed", () => {
    const legacy = parseStoredContent({ kind: "reference", title: "Runbook", body: "OPS-12" });

    expect(legacy.ok && outcome(applyPatch(legacy.value, { title: "Deploy runbook" }))).toEqual([
      "reference needs a locator: where it points (URL, path, ticket key)",
    ]);

    const fix = parsePatch({ title: "Deploy runbook", locator: "OPS-12" });
    expect(legacy.ok && fix.ok && applyPatch(legacy.value, fix.value).ok).toBe(true);
  });
});

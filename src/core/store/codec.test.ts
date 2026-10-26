import { describe, expect, test } from "bun:test";
import { memoryId } from "../../../test/memory-id";
import { validContent } from "../../../test/valid-content";
import { type Memory, type MemoryContent, newMemory } from "../model/memory";
import { err, ok } from "../model/result";
import type { ScopeRef } from "../model/scope";
import { decodeMemory, encodeMemory } from "./codec";

const ID = memoryId("01JB8Z6Q4R3M2N1P0V9W8X7Y6Z");
const OLDER_ID = memoryId("01JB8Z6Q4R3M2N1P0V9W8X7Y60");
const NOW = new Date("2026-01-02T03:04:05.000Z");

function memoryOf(content: MemoryContent, scope: ScopeRef = { level: "user" }): Memory {
  return newMemory(validContent(content), { id: ID, scope, now: NOW });
}

const fact = memoryOf({ kind: "fact", title: "Staging resets nightly", body: "Wiped at 02:00.\n" });

function errorOf(text: string): string {
  const result = decodeMemory(text);
  if (result.ok) {
    throw new Error("expected decoding to fail");
  }
  return result.error;
}

function withLine(line: string, replacement: string): string {
  const text = encodeMemory(fact);
  if (!text.includes(line)) {
    throw new Error(`fixture has no line ${line}`);
  }
  return text.replace(line, replacement);
}

describe("encodeMemory", () => {
  test("writes frontmatter in a fixed order followed by the body", () => {
    expect(encodeMemory(fact)).toBe(
      [
        "---",
        "id: 01JB8Z6Q4R3M2N1P0V9W8X7Y6Z",
        "kind: fact",
        "scope: user",
        "title: Staging resets nightly",
        "created: 2026-01-02T03:04:05.000Z",
        "updated: 2026-01-02T03:04:05.000Z",
        "---",
        "Wiped at 02:00.",
        "",
      ].join("\n"),
    );
  });

  test("places why, triggers and supersedes around the timestamps", () => {
    const memory = {
      ...newMemory(
        validContent({
          kind: "gotcha",
          title: "Deploy needs VPN",
          why: "The registry is private",
          triggers: { commands: ["make deploy"], keywords: ["release"] },
          body: "Connect first.",
        }),
        {
          id: ID,
          scope: { level: "repo", id: "github.com/acme/api" },
          now: NOW,
          supersedes: OLDER_ID,
        },
      ),
      updated: "2026-02-03T00:00:00.000Z",
    };

    expect(encodeMemory(memory)).toBe(
      [
        "---",
        "id: 01JB8Z6Q4R3M2N1P0V9W8X7Y6Z",
        "kind: gotcha",
        "scope: repo:github.com/acme/api",
        "title: Deploy needs VPN",
        "why: The registry is private",
        "triggers:",
        "  commands:",
        "    - make deploy",
        "  keywords:",
        "    - release",
        "created: 2026-01-02T03:04:05.000Z",
        "updated: 2026-02-03T00:00:00.000Z",
        "supersedes: 01JB8Z6Q4R3M2N1P0V9W8X7Y60",
        "---",
        "Connect first.",
      ].join("\n"),
    );
  });

  test("keeps a long title on one line", () => {
    const title = "word ".repeat(60).trim();

    const text = encodeMemory(memoryOf({ kind: "fact", title, body: "" }));

    expect(text).toContain(`title: ${title}\n`);
  });
});

describe("decodeMemory round trip", () => {
  const roundTrips: [string, Memory][] = [
    ["a memory with only required fields", fact],
    ["an empty body", memoryOf({ kind: "fact", title: "t", body: "" })],
    [
      "a body with surrounding whitespace",
      memoryOf({ kind: "fact", title: "t", body: "\n\n  indented\n\ttabbed  \n\n" }),
    ],
    [
      "a body with fence lines of its own",
      memoryOf({ kind: "fact", title: "t", body: "intro\n---\nmiddle\n---\n\n---\n" }),
    ],
    ["a body with CRLF line endings", memoryOf({ kind: "fact", title: "t", body: "a\r\nb\r\n" })],
    [
      "a body that starts with a fence",
      memoryOf({ kind: "fact", title: "t", body: "---\nnot frontmatter\n---\n" }),
    ],
    [
      "Slovak diacritics in every text field",
      memoryOf({
        kind: "rule",
        title: "Čas v UTC, nie lokálny",
        why: "Logy sa porovnávajú naprieč krajinami: žiadne výnimky",
        body: "Používaj vždy UTC. Ľúbostný šťastný ďateľ.",
      }),
    ],
    [
      "a title that YAML would read as another type",
      memoryOf({ kind: "fact", title: "true", body: "x" }),
    ],
    [
      "a title with YAML punctuation",
      memoryOf({ kind: "fact", title: "Use: colons, #hashes and 'quotes' \"too\"", body: "x" }),
    ],
    [
      "a multi-line why containing a fence line",
      memoryOf({ kind: "rule", title: "t", why: "first\n  indented\n---\nlast", body: "x" }),
    ],
    [
      "triggers of every kind",
      memoryOf({
        kind: "gotcha",
        title: "t",
        body: "x",
        triggers: {
          paths: ["src/**/*.ts"],
          commands: ["git push"],
          tools: ["bash"],
          keywords: ["deploy"],
        },
      }),
    ],
    [
      "a reference with its locator",
      memoryOf({ kind: "reference", title: "Runbook", body: "https://wiki.example.com/runbook" }),
    ],
    [
      "an org scope",
      memoryOf(
        { kind: "preference", title: "t", body: "x" },
        { level: "org", id: "github.com/acme" },
      ),
    ],
    [
      "a repo scope with a nested id",
      memoryOf(
        { kind: "fact", title: "t", body: "x" },
        { level: "repo", id: "github.com/acme/api" },
      ),
    ],
    [
      "a supersedes link and a later update",
      {
        ...newMemory(validContent({ kind: "fact", title: "t", body: "x" }), {
          id: ID,
          scope: { level: "product", id: "payments" },
          now: NOW,
          supersedes: OLDER_ID,
        }),
        updated: "2026-03-04T05:06:07.000Z",
      },
    ],
    [
      "an id made only of digits",
      {
        ...fact,
        id: memoryId("01234567890123456789012345"),
        supersedes: memoryId("00000000000000000000000001"),
      },
    ],
  ];

  test.each(roundTrips)("restores %s exactly", (_case, memory) => {
    expect(decodeMemory(encodeMemory(memory))).toEqual(ok(memory));
  });
});

describe("decodeMemory file layout", () => {
  const withCrlfBody = memoryOf({ kind: "fact", title: "t", body: "one\r\ntwo\r\n" });

  test("reads a CRLF file and keeps its CRLF body byte for byte", () => {
    const encoded = encodeMemory(withCrlfBody);
    const frontmatter = encoded.slice(0, encoded.length - withCrlfBody.body.length);

    const decoded = decodeMemory(frontmatter.replaceAll("\n", "\r\n") + withCrlfBody.body);

    expect(decoded).toEqual(ok(withCrlfBody));
  });

  test("reads a CRLF file whose frontmatter has a multi-line value", () => {
    const memory = memoryOf({ kind: "rule", title: "t", why: "first\nsecond", body: "x" });
    const encoded = encodeMemory(memory);

    expect(decodeMemory(encoded.replaceAll("\n", "\r\n"))).toEqual(ok({ ...memory, body: "x" }));
  });

  test("skips a leading byte order mark", () => {
    expect(decodeMemory(`\uFEFF${encodeMemory(fact)}`)).toEqual(ok(fact));
  });

  test("accepts a closing fence at the end of the file as an empty body", () => {
    const empty = memoryOf({ kind: "fact", title: "t", body: "" });
    const withoutFinalNewline = encodeMemory(empty).slice(0, -1);

    expect(withoutFinalNewline.endsWith("\n---")).toBe(true);
    expect(decodeMemory(withoutFinalNewline)).toEqual(ok(empty));
  });

  test("does not treat a longer dashed line as the closing fence", () => {
    expect(decodeMemory("---\nid: x\n--- not a fence\n----\n")).toEqual(
      err("missing closing --- line"),
    );
  });
});

describe("decodeMemory failures", () => {
  test("rejects text without frontmatter", () => {
    expect(decodeMemory("just a note\n")).toEqual(err("missing opening --- line"));
  });

  test("rejects frontmatter that is never closed", () => {
    expect(decodeMemory("---\nid: x\nkind: fact\n")).toEqual(err("missing closing --- line"));
  });

  test("rejects frontmatter that is not valid YAML", () => {
    const error = errorOf("---\nid: [unclosed\n---\nbody");

    expect(error).toStartWith("invalid YAML: ");
    expect(error).not.toContain("\n");
  });

  test.each([
    ["empty", "---\n---\nbody"],
    ["a list", "---\n- a\n- b\n---\nbody"],
    ["a scalar", "---\njust text\n---\nbody"],
  ])("rejects frontmatter that is %s instead of a mapping", (_case, text) => {
    expect(decodeMemory(text)).toEqual(err("frontmatter must be a mapping"));
  });

  test("rejects an id that is not a ULID", () => {
    expect(errorOf(withLine("id: 01JB8Z6Q4R3M2N1P0V9W8X7Y6Z", "id: nope"))).toBe(
      "id must be a ULID",
    );
  });

  test("rejects a supersedes that is not a ULID", () => {
    const text = withLine(
      "updated: 2026-01-02T03:04:05.000Z",
      "updated: 2026-01-02T03:04:05.000Z\nsupersedes: nope",
    );

    expect(errorOf(text)).toBe("supersedes must be a ULID");
  });

  test("rejects an unknown scope level", () => {
    expect(errorOf(withLine("scope: user", "scope: galaxy:far"))).toBe(
      'invalid scope "galaxy:far"',
    );
  });

  test("rejects a scope id that would leave the data directory", () => {
    expect(errorOf(withLine("scope: user", "scope: repo:../../etc"))).toBe(
      'invalid scope "repo:../../etc"',
    );
  });

  test("rejects a scope that is not text", () => {
    expect(errorOf(withLine("scope: user", "scope: 5"))).toBe("scope must be a string");
  });

  test("rejects a created date that does not parse", () => {
    const text = withLine("created: 2026-01-02T03:04:05.000Z", "created: yesterday");

    expect(errorOf(text)).toBe("created must be an ISO timestamp");
  });

  test.each([
    ["a date without a time", "2026-01-02"],
    ["a timestamp without milliseconds", "2026-01-02T03:04:05Z"],
    ["a timestamp with an offset", "2026-01-02T03:04:05.000+01:00"],
    ["a timestamp that rolls over", "2026-02-30T03:04:05.000Z"],
  ])("rejects an updated value that is %s", (_case, value) => {
    const text = withLine("updated: 2026-01-02T03:04:05.000Z", `updated: "${value}"`);

    expect(errorOf(text)).toBe("updated must be an ISO timestamp");
  });

  test("rejects a missing updated date", () => {
    expect(errorOf(withLine("updated: 2026-01-02T03:04:05.000Z\n", ""))).toBe(
      "updated must be an ISO timestamp",
    );
  });

  test("rejects a rule without why", () => {
    expect(errorOf(withLine("kind: fact", "kind: rule"))).toBe(
      "rule needs why: the reason it holds",
    );
  });

  test("rejects an unknown kind", () => {
    expect(errorOf(withLine("kind: fact", "kind: opinion"))).toStartWith("kind must be one of ");
  });

  test("reports every problem in one message", () => {
    const text = withLine("id: 01JB8Z6Q4R3M2N1P0V9W8X7Y6Z", "id: nope").replace(
      "scope: user",
      "scope: galaxy:far",
    );

    expect(errorOf(text)).toBe('id must be a ULID; invalid scope "galaxy:far"');
  });
});

import { describe, expect, test } from "bun:test";
import { memoryId } from "../../../../test/memory-id";
import { type ContentInput, validContent } from "../../../../test/valid-content";
import { type Memory, newMemory } from "../../model/memory";
import type { ScopeChain, ScopeRef } from "../../model/scope";
import type { IndexUsage } from "../lifecycle/index-exit";
import { INSTRUCTIONS } from "./instructions";
import { indexLine, renderSessionBlock } from "./session-block";

const USER: ScopeRef = { level: "user" };
const REPO: ScopeRef = { level: "repo", id: "github.com/acme/api" };
const CHAIN: ScopeChain = [USER, { level: "org", id: "github.com/acme" }, REPO];

interface Fixture {
  readonly n: number;
  readonly scope: ScopeRef;
  readonly updated?: string;
}

function memory(content: ContentInput, { n, scope, updated }: Fixture): Memory {
  return newMemory(validContent(content), {
    id: memoryId(`01JB8Z6Q4R3M2N1P0V9W8X${String(n).padStart(4, "0")}`),
    scope,
    now: new Date(updated ?? "2026-03-01T10:00:00.000Z"),
  });
}

const SCOPES_LINE = "Scopes here: user · org:github.com/acme · repo:github.com/acme/api";

const NOW = new Date("2026-03-01T10:00:00.000Z");
const NO_USAGE: IndexUsage = { stats: new Map(), now: NOW, exit: { sessions: 20, days: 30 } };

function render(memories: Memory[], indexLines = 40, usage: IndexUsage = NO_USAGE): string {
  return renderSessionBlock({ chain: CHAIN, productRepos: [], memories, indexLines, usage }).text;
}

describe("renderSessionBlock", () => {
  test("starts with the fixed instruction text, unchanged", () => {
    expect(render([]).startsWith(INSTRUCTIONS)).toBe(true);
  });

  test("is only the instructions and the scopes line when there is nothing to show", () => {
    expect(render([])).toBe(`${INSTRUCTIONS}\n\n${SCOPES_LINE}`);
  });

  test("shows rules, then preferences, then the index", () => {
    const text = render([
      memory({ kind: "fact", title: "Staging resets nightly", body: "b" }, { n: 1, scope: USER }),
      memory({ kind: "preference", title: "Short answers", body: "" }, { n: 2, scope: USER }),
      memory(
        { kind: "rule", title: "Use UTC", body: "Always.", why: "logs" },
        { n: 3, scope: USER },
      ),
    ]);

    const order = ["### Rules", "### Preferences", "### Index"].map((heading) =>
      text.indexOf(heading),
    );
    expect(order.every((position) => position > 0)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
  });

  test("shows a rule in full, with its reason", () => {
    const text = render([
      memory(
        { kind: "rule", title: "Use UTC", body: "Timestamps in UTC.", why: "logs" },
        { n: 4, scope: USER },
      ),
    ]);

    expect(text).toContain(
      "### Rules\n#### user\n- Use UTC (2026-03-01)\n  Timestamps in UTC.\n  Why: logs",
    );
  });

  test("shows when a rule applies under its reason", () => {
    const text = render([
      memory(
        { kind: "rule", title: "Use UTC", body: "", why: "logs", howToApply: "In log code" },
        { n: 4, scope: USER },
      ),
    ]);

    expect(text).toContain("  Why: logs\n  Applies: In log code");
  });

  test("shows when a fresh gotcha index entry applies on its own line", () => {
    const entry = memory(
      {
        kind: "gotcha",
        title: "Slow",
        body: "b",
        triggers: { tools: ["bash"] },
        howToApply: "On CI",
      },
      { n: 4, scope: USER },
    );

    expect(indexLine(entry)).toBe(`- [${entry.id}] Slow (2026-03-01)\n  Applies: On CI`);
  });

  test("dates a rule by its last update", () => {
    const text = render([
      memory(
        { kind: "rule", title: "Use UTC", body: "", why: "logs" },
        { n: 4, scope: USER, updated: "2026-01-15T23:59:59.000Z" },
      ),
    ]);

    expect(text).toContain("- Use UTC (2026-01-15)");
  });

  test("tells the agent memories are dated and to check what they name", () => {
    expect(INSTRUCTIONS).toContain("Memories are dated");
    expect(INSTRUCTIONS).toContain("file, flag or command");
  });

  test("groups by scope with the narrowest scope last", () => {
    const text = render([
      memory({ kind: "rule", title: "Repo rule", body: "", why: "w" }, { n: 5, scope: REPO }),
      memory({ kind: "rule", title: "User rule", body: "", why: "w" }, { n: 6, scope: USER }),
    ]);

    expect(text.indexOf("#### user")).toBeLessThan(text.indexOf("#### repo:github.com/acme/api"));
  });

  test("lists facts and decisions as index lines by id and title", () => {
    const fact = memory(
      { kind: "decision", title: "Postgres over Mongo", body: "b", why: "w" },
      { n: 9, scope: REPO },
    );

    expect(render([fact])).toContain(
      `#### repo:github.com/acme/api\n- [${fact.id}] Postgres over Mongo (2026-03-01)`,
    );
  });

  test("caps the index at the newest entries", () => {
    const old = memory(
      { kind: "fact", title: "Old", body: "b" },
      { n: 7, scope: USER, updated: "2026-01-01T00:00:00.000Z" },
    );
    const recent = memory(
      { kind: "fact", title: "Recent", body: "b" },
      { n: 10, scope: USER, updated: "2026-02-01T00:00:00.000Z" },
    );

    const text = render([old, recent], 1);

    expect(text).toContain("Recent");
    expect(text).not.toContain("Old");
  });

  test("lists the most recently read fact before the most recently updated one", () => {
    const updatedLately = memory(
      { kind: "fact", title: "Updated lately", body: "b" },
      { n: 16, scope: USER, updated: "2026-02-20T00:00:00.000Z" },
    );
    const readLately = memory(
      { kind: "fact", title: "Read lately", body: "b" },
      { n: 17, scope: USER, updated: "2026-01-01T00:00:00.000Z" },
    );
    const usage: IndexUsage = {
      ...NO_USAGE,
      stats: new Map([
        [
          readLately.id,
          {
            reads: 1,
            lastRead: new Date("2026-02-25T00:00:00.000Z"),
            sessionsSinceRead: 0,
            fires: 0,
          },
        ],
      ]),
    };

    const text = render([updatedLately, readLately], 40, usage);

    expect(text.indexOf("Read lately")).toBeLessThan(text.indexOf("Updated lately"));
  });

  test("leaves out a fact that left the index and fills the cap with the next one", () => {
    const stale = memory(
      { kind: "fact", title: "Stale", body: "b" },
      { n: 18, scope: USER, updated: "2026-02-20T00:00:00.000Z" },
    );
    const older = memory(
      { kind: "fact", title: "Older", body: "b" },
      { n: 19, scope: USER, updated: "2026-01-01T00:00:00.000Z" },
    );
    const usage: IndexUsage = {
      ...NO_USAGE,
      now: new Date("2026-06-01T00:00:00.000Z"),
      stats: new Map([[stale.id, { reads: 0, sessionsSinceRead: 20, fires: 0 }]]),
    };

    const text = render([stale, older], 1, usage);

    expect(text).not.toContain("Stale");
    expect(text).toContain("Older");
  });

  test("leaves gotchas and references out of the block", () => {
    const text = render([
      memory(
        { kind: "gotcha", title: "Migrations lock", body: "b", triggers: { tools: ["bash"] } },
        { n: 11, scope: USER },
      ),
      memory(
        { kind: "reference", title: "Runbook", body: "b", locator: "https://x.example/r" },
        { n: 8, scope: USER },
      ),
    ]);

    expect(text).toBe(`${INSTRUCTIONS}\n\n${SCOPES_LINE}`);
  });

  test("reports exactly the memories it shows", () => {
    const shownRule = memory(
      { kind: "rule", title: "Use UTC", body: "", why: "w" },
      { n: 12, scope: USER },
    );
    const hiddenGotcha = memory(
      { kind: "gotcha", title: "memory", body: "b", triggers: { tools: ["bash"] } },
      { n: 13, scope: USER },
    );
    const cutFact = memory(
      { kind: "fact", title: "Use", body: "b" },
      { n: 14, scope: USER, updated: "2025-01-01T00:00:00.000Z" },
    );
    const keptFact = memory({ kind: "fact", title: "Kept", body: "b" }, { n: 15, scope: USER });

    const { shown } = renderSessionBlock({
      chain: CHAIN,
      productRepos: [],
      memories: [shownRule, hiddenGotcha, cutFact, keptFact],
      indexLines: 1,
      usage: NO_USAGE,
    });

    expect(shown).toEqual([shownRule.id, keptFact.id]);
  });
});

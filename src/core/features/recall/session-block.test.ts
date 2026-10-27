import { describe, expect, test } from "bun:test";
import { memoryId } from "../../../../test/memory-id";
import { validContent } from "../../../../test/valid-content";
import { type Memory, type MemoryContent, newMemory } from "../../model/memory";
import type { ScopeChain, ScopeRef } from "../../model/scope";
import { INSTRUCTIONS } from "./instructions";
import { renderSessionBlock } from "./session-block";

const USER: ScopeRef = { level: "user" };
const REPO: ScopeRef = { level: "repo", id: "github.com/acme/api" };
const CHAIN: ScopeChain = [USER, { level: "org", id: "github.com/acme" }, REPO];

interface Fixture {
  readonly n: number;
  readonly scope: ScopeRef;
  readonly updated?: string;
}

function memory(content: MemoryContent, { n, scope, updated }: Fixture): Memory {
  return newMemory(validContent(content), {
    id: memoryId(`01JB8Z6Q4R3M2N1P0V9W8X${String(n).padStart(4, "0")}`),
    scope,
    now: new Date(updated ?? "2026-03-01T10:00:00.000Z"),
  });
}

function render(memories: Memory[], indexLines = 40): string {
  return renderSessionBlock({ chain: CHAIN, memories, indexLines });
}

describe("renderSessionBlock", () => {
  test("starts with the fixed instruction text, unchanged", () => {
    expect(render([]).startsWith(INSTRUCTIONS)).toBe(true);
  });

  test("is only the instruction text when there is nothing to show", () => {
    expect(render([])).toBe(INSTRUCTIONS);
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

    expect(text).toContain("### Rules\n#### user\n- Use UTC\n  Timestamps in UTC.\n  Why: logs");
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
      `#### repo:github.com/acme/api\n- [${fact.id}] Postgres over Mongo`,
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

  test("leaves gotchas and references out of the block", () => {
    const text = render([
      memory(
        { kind: "gotcha", title: "Migrations lock", body: "b", triggers: { tools: ["bash"] } },
        { n: 11, scope: USER },
      ),
      memory(
        { kind: "reference", title: "Runbook", body: "https://x.example/r" },
        { n: 8, scope: USER },
      ),
    ]);

    expect(text).toBe(INSTRUCTIONS);
  });
});

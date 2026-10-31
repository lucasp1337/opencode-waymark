import { describe, expect, test } from "bun:test";
import { memoryId } from "../../../../test/memory-id";
import { validContent } from "../../../../test/valid-content";
import type { MemoryId } from "../../model/id";
import { type Memory, type MemoryContent, newMemory } from "../../model/memory";
import { DAY_MS, type MemoryStats } from "../../telemetry/telemetry";
import { type IndexUsage, visibleIndex } from "./index-exit";

const CREATED = new Date("2026-01-01T00:00:00.000Z");
const EXIT = { sessions: 20, days: 30 };

function id(n: number): MemoryId {
  return memoryId(`01JB8Z6Q4R3M2N1P0V9W8X${String(n).padStart(4, "0")}`);
}

function fact(n: number, updated: Date = CREATED): Memory {
  const content: MemoryContent = { kind: "fact", title: `Fact ${n}`, body: "b" };
  return {
    ...newMemory(validContent(content), { id: id(n), scope: { level: "user" }, now: CREATED }),
    updated: updated.toISOString(),
  };
}

type Seen = [Memory, Partial<MemoryStats>];

function usage(stats: Seen[], now: Date, exit = EXIT): IndexUsage {
  return {
    stats: new Map(
      stats.map(([memory, partial]) => [
        memory.id,
        { reads: 0, sessionsSinceRead: 0, fires: 0, ...partial },
      ]),
    ),
    now,
    exit,
  };
}

function after(created: Date, ms: number): Date {
  return new Date(created.getTime() + ms);
}

function titles(memories: Memory[]): string[] {
  return memories.map((memory) => memory.title);
}

describe("visibleIndex exit", () => {
  const item = fact(1);
  const THIRTY_DAYS = 30 * DAY_MS;

  test("keeps a memory with 19 sessions since its last read", () => {
    const seen = usage([[item, { sessionsSinceRead: 19 }]], after(CREATED, THIRTY_DAYS));

    expect(visibleIndex([item], seen)).toEqual([item]);
  });

  test("drops a memory at 20 sessions and 30 days since creation when never read", () => {
    const seen = usage([[item, { sessionsSinceRead: 20 }]], after(CREATED, THIRTY_DAYS));

    expect(visibleIndex([item], seen)).toEqual([]);
  });

  test("keeps a memory 29 days 23 hours after creation", () => {
    const seen = usage(
      [[item, { sessionsSinceRead: 20 }]],
      after(CREATED, THIRTY_DAYS - 60 * 60 * 1000),
    );

    expect(visibleIndex([item], seen)).toEqual([item]);
  });

  test("keeps a memory with many sessions but fewer than 30 days", () => {
    const seen = usage([[item, { sessionsSinceRead: 500 }]], after(CREATED, 5 * DAY_MS));

    expect(visibleIndex([item], seen)).toEqual([item]);
  });

  test("keeps a memory with many days but fewer than 20 sessions", () => {
    const seen = usage([[item, { sessionsSinceRead: 3 }]], after(CREATED, 400 * DAY_MS));

    expect(visibleIndex([item], seen)).toEqual([item]);
  });

  test("counts the days from the last read instead of creation", () => {
    const lastRead = after(CREATED, 100 * DAY_MS);
    const stats = { sessionsSinceRead: 20, lastRead };

    const recent = usage([[item, stats]], after(lastRead, THIRTY_DAYS - 1));
    const idle = usage([[item, stats]], after(lastRead, THIRTY_DAYS));

    expect(visibleIndex([item], recent)).toEqual([item]);
    expect(visibleIndex([item], idle)).toEqual([]);
  });

  test("keeps a memory that was just read, however long ago it was created", () => {
    const now = after(CREATED, 400 * DAY_MS);
    const seen = usage([[item, { sessionsSinceRead: 0, lastRead: now }]], now);

    expect(visibleIndex([item], seen)).toEqual([item]);
  });

  test("treats a memory without stats as never read and never seen", () => {
    expect(visibleIndex([item], usage([], after(CREATED, 400 * DAY_MS)))).toEqual([item]);
  });

  test("uses the given thresholds", () => {
    const seen = usage([[item, { sessionsSinceRead: 2 }]], after(CREATED, 3 * DAY_MS), {
      sessions: 2,
      days: 3,
    });

    expect(visibleIndex([item], seen)).toEqual([]);
  });
});

describe("visibleIndex order", () => {
  const NOW = after(CREATED, 10 * DAY_MS);

  test("puts the most recently read first, never-read ones last", () => {
    const [a, b, c] = [fact(1), fact(2), fact(3)];
    const seen = usage(
      [
        [a, { lastRead: after(CREATED, DAY_MS) }],
        [c, { lastRead: after(CREATED, 2 * DAY_MS) }],
      ],
      NOW,
    );

    expect(titles(visibleIndex([a, b, c], seen))).toEqual(["Fact 3", "Fact 1", "Fact 2"]);
  });

  test("orders never-read memories by most recently updated", () => {
    const older = fact(1, after(CREATED, DAY_MS));
    const newer = fact(2, after(CREATED, 2 * DAY_MS));

    expect(titles(visibleIndex([older, newer], usage([], NOW)))).toEqual(["Fact 2", "Fact 1"]);
  });

  test("puts a fact saved after another's last read ahead of it", () => {
    const readOnce = fact(1);
    const saved = fact(2, after(CREATED, 5 * DAY_MS));
    const seen = usage([[readOnce, { lastRead: after(CREATED, DAY_MS) }]], NOW);

    expect(titles(visibleIndex([readOnce, saved], seen))).toEqual(["Fact 2", "Fact 1"]);
  });

  test("puts a fact read after another's update ahead of it", () => {
    const updatedEarly = fact(1, after(CREATED, DAY_MS));
    const readLater = fact(2);
    const seen = usage([[readLater, { lastRead: after(CREATED, 2 * DAY_MS) }]], NOW);

    expect(titles(visibleIndex([updatedEarly, readLater], seen))).toEqual(["Fact 2", "Fact 1"]);
  });

  test("keeps the given order for equal activity", () => {
    expect(titles(visibleIndex([fact(2), fact(1)], usage([], NOW)))).toEqual(["Fact 2", "Fact 1"]);
  });

  test("leaves out memories of kinds the index does not list", () => {
    const rule = newMemory(validContent({ kind: "rule", title: "R", body: "", why: "w" }), {
      id: id(9),
      scope: { level: "user" },
      now: CREATED,
    });

    expect(visibleIndex([rule], usage([], NOW))).toEqual([]);
  });
});

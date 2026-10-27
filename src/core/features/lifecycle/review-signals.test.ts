import { describe, expect, test } from "bun:test";
import { memoryId } from "../../../../test/memory-id";
import { validContent } from "../../../../test/valid-content";
import type { MemoryId } from "../../model/id";
import { type Memory, type MemoryContent, newMemory } from "../../model/memory";
import type { ScopeChain } from "../../model/scope";
import { DAY_MS, type MemoryStats, UNSEEN } from "../../telemetry/telemetry";
import { createReviewSignals } from "./review-signals";

const CREATED = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date(CREATED.getTime() + 60 * DAY_MS);
const CHAIN: ScopeChain = [{ level: "user" }];

function id(n: number): MemoryId {
  return memoryId(`01JB8Z6Q4R3M2N1P0V9W8X${String(n).padStart(4, "0")}`);
}

function memory(n: number, content: MemoryContent, supersedes?: MemoryId): Memory {
  return newMemory(validContent(content), {
    id: id(n),
    scope: { level: "user" },
    now: CREATED,
    ...(supersedes === undefined ? {} : { supersedes }),
  });
}

const idleFact = memory(1, { kind: "fact", title: "Idle fact", body: "b" });
const idleDecision = memory(2, { kind: "decision", title: "Idle decision", body: "b", why: "w" });
const gotcha = memory(3, {
  kind: "gotcha",
  title: "Noisy",
  body: "b",
  triggers: { tools: ["bash"] },
});

interface Counted {
  readonly stats?: ReadonlyMap<MemoryId, MemoryStats>;
  readonly fires?: ReadonlyMap<MemoryId, number>;
}

function signalsFor(
  memories: Memory[],
  counted: Counted = {},
  indexExit = { sessions: 20, days: 30 },
) {
  const asked: Array<{ id: MemoryId; days: number }> = [];
  const signals = createReviewSignals({
    store: { inScopes: () => memories },
    counters: {
      stats: (ids) => new Map(ids.map((known) => [known, counted.stats?.get(known) ?? UNSEEN])),
      firesWithin: (known, days) => {
        asked.push({ id: known, days });
        return counted.fires?.get(known) ?? 0;
      },
    },
    now: () => NOW,
    indexExit: () => indexExit,
    noisy: { fires: 10, days: 30 },
  });
  return { signals: signals(CHAIN), asked };
}

const IDLE: MemoryStats = { ...UNSEEN, sessionsSinceRead: 20 };

describe("review signals left-index", () => {
  test("lists the facts and decisions that were idle long enough", () => {
    const stats = new Map([
      [idleFact.id, IDLE],
      [idleDecision.id, IDLE],
    ]);

    expect(signalsFor([idleFact, idleDecision], { stats }).signals.leftIndex).toEqual([
      idleFact.id,
      idleDecision.id,
    ]);
  });

  test("leaves out a fact that is still in the index", () => {
    const stats = new Map([[idleDecision.id, IDLE]]);

    expect(signalsFor([idleFact, idleDecision], { stats }).signals.leftIndex).toEqual([
      idleDecision.id,
    ]);
  });

  test("leaves out memories of kinds the index never lists", () => {
    const rule = memory(4, { kind: "rule", title: "Rule", body: "", why: "w" });
    const stats = new Map([
      [rule.id, IDLE],
      [idleFact.id, IDLE],
    ]);

    expect(signalsFor([rule, idleFact], { stats }).signals.leftIndex).toEqual([idleFact.id]);
  });

  test("leaves out a superseded fact", () => {
    const newer = memory(5, { kind: "fact", title: "Newer", body: "b" }, idleFact.id);
    const stats = new Map([
      [idleFact.id, IDLE],
      [newer.id, IDLE],
    ]);

    expect(signalsFor([idleFact, newer], { stats }).signals.leftIndex).toEqual([newer.id]);
  });

  test("uses the exit thresholds as they are at review time", () => {
    const stats = new Map([[idleFact.id, { ...UNSEEN, sessionsSinceRead: 3 }]]);

    expect(signalsFor([idleFact], { stats }).signals.leftIndex).toEqual([]);
    expect(signalsFor([idleFact], { stats }, { sessions: 3, days: 30 }).signals.leftIndex).toEqual([
      idleFact.id,
    ]);
  });
});

describe("review signals noisy", () => {
  test("lists a gotcha that fired as often as the threshold within the window", () => {
    const fires = new Map([[gotcha.id, 10]]);

    const { signals, asked } = signalsFor([gotcha], { fires });

    expect(signals.noisy).toEqual([gotcha.id]);
    expect(asked).toContainEqual({ id: gotcha.id, days: 30 });
  });

  test("leaves out a gotcha just below the threshold", () => {
    const quiet = memory(6, {
      kind: "gotcha",
      title: "Quiet",
      body: "b",
      triggers: { tools: ["x"] },
    });
    const fires = new Map([
      [gotcha.id, 10],
      [quiet.id, 9],
    ]);

    expect(signalsFor([gotcha, quiet], { fires }).signals.noisy).toEqual([gotcha.id]);
  });

  test("leaves out a fact however often it fired", () => {
    const fires = new Map([
      [idleFact.id, 50],
      [gotcha.id, 10],
    ]);

    expect(signalsFor([idleFact, gotcha], { fires }).signals.noisy).toEqual([gotcha.id]);
  });

  test("leaves out a superseded gotcha", () => {
    const newer = memory(
      7,
      { kind: "gotcha", title: "Newer", body: "b", triggers: { tools: ["bash"] } },
      gotcha.id,
    );
    const fires = new Map([
      [gotcha.id, 20],
      [newer.id, 10],
    ]);

    expect(signalsFor([gotcha, newer], { fires }).signals.noisy).toEqual([newer.id]);
  });
});

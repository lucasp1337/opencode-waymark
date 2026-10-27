import { describe, expect, test } from "bun:test";
import { memoryId } from "../../../../test/memory-id";
import { validContent } from "../../../../test/valid-content";
import { type MemoryContent, newMemory } from "../../model/memory";
import type { NoisyThresholds } from "./lifecycle-settings";
import { isNoisy, noisyGotchaLine } from "./noisy-gotcha";

const NOISY: NoisyThresholds = { fires: 10, days: 30 };
const ID = "01JB8Z6Q4R3M2N1P0V9W8X0001";

function memory(content: MemoryContent) {
  return newMemory(validContent(content), {
    id: memoryId(ID),
    scope: { level: "user" },
    now: new Date(0),
  });
}

const gotcha = memory({ kind: "gotcha", title: "G", body: "b", triggers: { tools: ["bash"] } });

describe("isNoisy", () => {
  test("is true for a gotcha at the threshold and above", () => {
    expect(isNoisy(gotcha, 10, NOISY)).toBe(true);
    expect(isNoisy(gotcha, 11, NOISY)).toBe(true);
  });

  test("is false for a gotcha just below the threshold", () => {
    expect(isNoisy(gotcha, 9, NOISY)).toBe(false);
  });

  test("is false for a fact however often it fired", () => {
    const fact = memory({ kind: "fact", title: "F", body: "b", triggers: { tools: ["bash"] } });

    expect(isNoisy(fact, 99, NOISY)).toBe(false);
  });
});

describe("noisyGotchaLine", () => {
  test("asks the agent to check with the user once a gotcha reached the threshold", () => {
    expect(noisyGotchaLine(gotcha, 10, NOISY)).toBe(
      `waymark · this gotcha fired 10 times in 30 days. Ask the user whether to keep it, forget it (memory_forget ${ID}), or turn it into a rule.`,
    );
  });

  test("says nothing just below the threshold", () => {
    expect(noisyGotchaLine(gotcha, 9, NOISY)).toBeNull();
  });

  test("reports the count and window it was given", () => {
    expect(noisyGotchaLine(gotcha, 7, { fires: 5, days: 14 })).toContain(
      "fired 7 times in 14 days",
    );
  });

  test("says nothing about a memory that is not a gotcha", () => {
    const fact = memory({ kind: "fact", title: "F", body: "b", triggers: { tools: ["bash"] } });

    expect(noisyGotchaLine(fact, 99, NOISY)).toBeNull();
  });
});

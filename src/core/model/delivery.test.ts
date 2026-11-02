import { describe, expect, test } from "bun:test";
import { memoryId } from "../../../test/memory-id";
import { type ContentInput, validContent } from "../../../test/valid-content";
import { isDeliveredOnTrigger, isListedInIndex, isShownAlways } from "./delivery";
import { type Memory, newMemory } from "./memory";
import type { ScopeRef } from "./scope";

const PRODUCT: ScopeRef = { level: "product", id: "payments" };
const REPO: ScopeRef = { level: "repo", id: "x/a" };

function rule(scope: ScopeRef, triggers?: ContentInput["triggers"]): Memory {
  return newMemory(
    validContent({ kind: "rule", title: "t", body: "b", why: "w", ...(triggers && { triggers }) }),
    { id: memoryId("01JB8Z6Q4R3M2N1P0V9W8X0001"), scope, now: new Date(0) },
  );
}

describe("delivery", () => {
  test("a rule is shown always and not listed, by its kind", () => {
    const memory = rule(PRODUCT);

    expect(isShownAlways(memory)).toBe(true);
    expect(isListedInIndex(memory)).toBe(false);
    expect(isDeliveredOnTrigger(memory)).toBe(false);
  });

  test("a rule aimed at repos at product scope is listed and triggered, not shown always", () => {
    const memory = rule(PRODUCT, { repos: ["x/a"] });

    expect(isShownAlways(memory)).toBe(false);
    expect(isListedInIndex(memory)).toBe(true);
    expect(isDeliveredOnTrigger(memory)).toBe(true);
  });

  test("a hand-edited memory aimed at repos outside product scope stays an ordinary memory", () => {
    const memory = rule(REPO, { repos: ["x/a"] });

    expect(isShownAlways(memory)).toBe(true);
    expect(isListedInIndex(memory)).toBe(false);
    expect(isDeliveredOnTrigger(memory)).toBe(false);
  });
});

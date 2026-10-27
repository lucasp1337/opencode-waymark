import { describe, expect, test } from "bun:test";
import { memoryId } from "../../../../test/memory-id";
import { validContent } from "../../../../test/valid-content";
import { type Memory, newMemory } from "../../model/memory";
import type { ScopeChain } from "../../model/scope";
import { INSTRUCTIONS } from "./instructions";
import type { RecallScope } from "./recall-scope";
import { createSessionBlocks } from "./session-blocks";

const CHAIN: ScopeChain = [{ level: "user" }];

function rule(id: string, title: string, supersedes?: string): Memory {
  return newMemory(validContent({ kind: "rule", title, body: "", why: "w" }), {
    id: memoryId(id),
    scope: { level: "user" },
    now: new Date(0),
    ...(supersedes === undefined ? {} : { supersedes: memoryId(supersedes) }),
  });
}

function blocksOver(
  stored: Memory[],
  scope: RecallScope | null = { chain: CHAIN, directory: "/d" },
) {
  return createSessionBlocks({
    store: { inScopes: () => stored },
    recallScope: () => Promise.resolve(scope),
    indexLines: 40,
  });
}

describe("createSessionBlocks", () => {
  test("renders the session's active memories", async () => {
    const block = await blocksOver([rule("01JB8Z6Q4R3M2N1P0V9W8X0001", "Use UTC")]).blockFor("s");

    expect(block).toContain("- Use UTC");
  });

  test("returns the first rendering again even after new memories appear", async () => {
    const stored = [rule("01JB8Z6Q4R3M2N1P0V9W8X0001", "Use UTC")];
    const blocks = blocksOver(stored);
    const first = await blocks.blockFor("s");

    stored.push(rule("01JB8Z6Q4R3M2N1P0V9W8X0002", "Added later"));

    expect(await blocks.blockFor("s")).toBe(first);
  });

  test("leaves out a superseded rule", async () => {
    const block = await blocksOver([
      rule("01JB8Z6Q4R3M2N1P0V9W8X0001", "Old rule"),
      rule("01JB8Z6Q4R3M2N1P0V9W8X0002", "New rule", "01JB8Z6Q4R3M2N1P0V9W8X0001"),
    ]).blockFor("s");

    expect(block).not.toContain("Old rule");
    expect(block).toContain("New rule");
  });

  test("gives a session without recall nothing", async () => {
    expect(await blocksOver([], null).blockFor("s")).toBeNull();
  });

  test("an empty store still gives the instructions", async () => {
    expect(await blocksOver([]).blockFor("s")).toBe(INSTRUCTIONS);
  });
});

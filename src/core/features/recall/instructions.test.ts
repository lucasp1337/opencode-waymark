import { describe, expect, test } from "bun:test";
import { memoryInstructions, SAVE_SKILL_POINTER } from "./instructions";

describe("memoryInstructions", () => {
  test("puts the save guidance between the save triggers and the staleness lines", () => {
    const text = memoryInstructions("GUIDANCE");

    expect(text.indexOf("Save (memory_save)")).toBeLessThan(text.indexOf("GUIDANCE"));
    expect(text.indexOf("GUIDANCE")).toBeLessThan(text.indexOf("Memories are dated"));
  });

  test("keeps the save triggers, the same-turn rule and the secret rule", () => {
    const text = memoryInstructions("");

    expect(text).toContain("the user corrects you or states a preference");
    expect(text).toContain("in that same turn");
    expect(text).toContain("Never copy a secret");
  });

  test("tells the agent to check what a dated memory names, forget carefully and search first", () => {
    const text = memoryInstructions("");

    expect(text).toContain("file, flag or command");
    expect(text).toContain("Forget (memory_forget) only when");
    expect(text).toContain("Search memory (memory_search) before asking");
  });

  test("without save guidance leaves no gap where it would have been", () => {
    expect(memoryInstructions("")).not.toContain("\n\n\n");
  });

  test("the skill pointer names the waymark-save skill", () => {
    expect(SAVE_SKILL_POINTER).toContain("`waymark-save` skill");
  });
});

import { describe, expect, test } from "bun:test";
import { compactionNote } from "./compaction";

describe("compactionNote", () => {
  test("asks for a Not yet saved to memory list at the end of the summary", () => {
    const note = compactionNote({ compactionSave: true });

    expect(note).toContain('End the summary with a section headed "Not yet saved to memory"');
    expect(note).toContain("a future session would otherwise have to rediscover");
  });

  test("tells the agent that continues to save the listed items with memory_save", () => {
    const note = compactionNote({ compactionSave: true });

    expect(note).toContain("Save each item below with memory_save");
  });

  test("is null while compaction save is off", () => {
    expect(compactionNote({ compactionSave: false })).toBeNull();
  });
});

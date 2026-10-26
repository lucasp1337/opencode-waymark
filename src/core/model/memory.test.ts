import { describe, expect, test } from "bun:test";
import { validContent } from "../../../test/valid-content";
import { isMemoryId, type MemoryId } from "./id";
import { newMemory } from "./memory";

function memoryId(text: string): MemoryId {
  if (!isMemoryId(text)) {
    throw new Error(`fixture id ${text} is not a ULID`);
  }
  return text;
}

const ID = memoryId("01JB8Z6Q4R3M2N1P0V9W8X7Y6Z");
const content = validContent({ kind: "fact", title: "t", body: "b" });

describe("newMemory", () => {
  test("stamps created and updated with the same instant", () => {
    const memory = newMemory(content, {
      id: ID,
      scope: { level: "user" },
      now: new Date("2026-01-02T03:04:05.000Z"),
    });

    expect(memory.created).toBe("2026-01-02T03:04:05.000Z");
    expect(memory.updated).toBe(memory.created);
    expect(memory.id).toBe(ID);
    expect(memory.supersedes).toBeUndefined();
  });

  test("records the memory it supersedes", () => {
    const old = memoryId("01JB8Z6Q4R3M2N1P0V9W8X7Y60");

    const memory = newMemory(content, {
      id: ID,
      scope: { level: "user" },
      now: new Date(0),
      supersedes: old,
    });

    expect(memory.supersedes).toBe(old);
  });
});

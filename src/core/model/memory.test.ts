import { describe, expect, test } from "bun:test";
import { memoryId } from "../../../test/memory-id";
import { validContent } from "../../../test/valid-content";
import { activeOnly, newMemory } from "./memory";

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

describe("activeOnly", () => {
  test("drops a memory that another one supersedes", () => {
    const old = newMemory(content, {
      id: memoryId("01JB8Z6Q4R3M2N1P0V9W8X0001"),
      scope: { level: "user" },
      now: new Date(0),
    });
    const successor = newMemory(content, {
      id: memoryId("01JB8Z6Q4R3M2N1P0V9W8X0002"),
      scope: { level: "user" },
      now: new Date(0),
      supersedes: old.id,
    });
    const unrelated = newMemory(content, {
      id: memoryId("01JB8Z6Q4R3M2N1P0V9W8X0003"),
      scope: { level: "user" },
      now: new Date(0),
    });

    expect(activeOnly([old, successor, unrelated]).map((memory) => memory.id)).toEqual([
      successor.id,
      unrelated.id,
    ]);
  });
});

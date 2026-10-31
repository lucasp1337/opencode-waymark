import { describe, expect, test } from "bun:test";
import { memoryId } from "../../../../test/memory-id";
import { validContent } from "../../../../test/valid-content";
import { newMemory } from "../../model/memory";
import type { ToolDef } from "../../port";
import type { MemoryStore } from "../../store/memory-store";
import { createOwnWrites } from "./own-writes";

const memory = newMemory(validContent({ kind: "fact", title: "Cache is Redis", body: "b" }), {
  id: memoryId("01JB8Z6Q4R3M2N1P0V9W8X0001"),
  scope: { level: "user" },
  now: new Date("2026-03-01T10:00:00.000Z"),
});

function fakeStore(): MemoryStore {
  return {
    save: () => undefined,
    forget: () => undefined,
    get: () => undefined,
    inScopes: () => [],
    related: () => [],
    resync: () => ({ indexed: 0, removed: 0, invalid: [] }),
    generation: () => 0,
    close: () => undefined,
  };
}

function saveTool(store: MemoryStore): ToolDef {
  return {
    name: "any_tool",
    description: "",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      await Promise.resolve();
      store.save(memory);
      return "saved";
    },
  };
}

async function saveInSession(own: ReturnType<typeof createOwnWrites>, sessionID: string) {
  const store = own.attributeStore(fakeStore());
  await own.attributeTool(saveTool(store)).execute({}, { sessionID });
}

describe("own writes", () => {
  test("a memory saved inside a session's tool call is that session's own", async () => {
    const own = createOwnWrites();

    await saveInSession(own, "s1");

    expect(own.isOwn("s1", memory)).toBe(true);
  });

  test("another session did not write it", async () => {
    const own = createOwnWrites();

    await saveInSession(own, "s1");

    expect(own.isOwn("s2", memory)).toBe(false);
  });

  test("a save outside any tool call belongs to no session", () => {
    const own = createOwnWrites();

    own.attributeStore(fakeStore()).save(memory);

    expect(own.isOwn("s1", memory)).toBe(false);
  });

  test("a later version of the memory is not the one the session wrote", async () => {
    const own = createOwnWrites();
    await saveInSession(own, "s1");

    expect(own.isOwn("s1", { ...memory, updated: "2026-03-02T10:00:00.000Z" })).toBe(false);
  });

  test("forgetting a session drops what it wrote", async () => {
    const own = createOwnWrites();
    await saveInSession(own, "s1");

    own.forget("s1");

    expect(own.isOwn("s1", memory)).toBe(false);
  });
});

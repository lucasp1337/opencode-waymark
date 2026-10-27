import { describe, expect, test } from "bun:test";
import { memoryId } from "../../../../test/memory-id";
import {
  FIRST_ID as ID,
  type RuntimeFixture,
  SESSION,
  useRuntime,
} from "../../../../test/runtime-fixture";
import { validContent } from "../../../../test/valid-content";
import { newMemory } from "../../model/memory";
import { nodeFileSystem } from "../../store/fs";
import { createMemoryFiles } from "../../store/memory-files";

const runtime = useRuntime();

// A runtime that found one fact on disk when it started.
function withStoredFact(): RuntimeFixture {
  const empty = runtime();
  createMemoryFiles(empty.dataDir, nodeFileSystem).write(
    newMemory(validContent({ kind: "fact", title: "Staging resets nightly", body: "At 02:00." }), {
      id: memoryId(ID),
      scope: { level: "user" },
      now: new Date("2026-03-01T10:00:00.000Z"),
    }),
  );
  return empty.restart();
}

function read(fx: RuntimeFixture, id: string): Promise<string> {
  return fx.host.callTool("memory_read", { id }, SESSION);
}

describe("memory_read", () => {
  test("returns the whole memory as stored", async () => {
    const fx = withStoredFact();

    expect(await read(fx, ID)).toBe(
      [
        "---",
        `id: ${ID}`,
        "kind: fact",
        "scope: user",
        "title: Staging resets nightly",
        "created: 2026-03-01T10:00:00.000Z",
        "updated: 2026-03-01T10:00:00.000Z",
        "---",
        "At 02:00.",
      ].join("\n"),
    );
  });

  test("explains an unknown id", async () => {
    const fx = withStoredFact();

    expect(await read(fx, "01JB8Z6Q4R3M2N1P0V9W8X9999")).toBe(
      "no memory with id 01JB8Z6Q4R3M2N1P0V9W8X9999",
    );
  });

  test("explains an id that is not a memory id", async () => {
    const fx = withStoredFact();

    expect(await read(fx, "abc")).toBe(
      'id must be a memory id like 01JB8Z6Q4R3M2N1P0V9W8X7Y6Z, got "abc"',
    );
  });
});

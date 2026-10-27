import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { newMemory } from "../../src/core/model/memory";
import { nodeFileSystem } from "../../src/core/store/fs";
import { createMemoryFiles } from "../../src/core/store/memory-files";
import { memoryId } from "../memory-id";
import { validContent } from "../valid-content";
import { at, type LiveEnv, liveEnvWithWaymark, probeLines, waitUntil } from "./harness";

function syncedCounts(env: LiveEnv): Array<{ indexed: unknown; removed: unknown }> {
  return probeLines(env, "memory cache synced").map((line) => ({
    indexed: at(line, "indexed"),
    removed: at(line, "removed"),
  }));
}

async function activateOnce(env: LiveEnv, activations: number): Promise<void> {
  const server = await env.serve();
  try {
    await server.newSession();
    await waitUntil(() => syncedCounts(env).length >= activations);
  } finally {
    await server.stop();
  }
}

describe("memory store in a real opencode process", () => {
  test("activation indexes memory files and a deleted cache is rebuilt on the next start", async () => {
    const env = liveEnvWithWaymark();
    const dataDir = join(env.dataHome, "waymark");
    createMemoryFiles(dataDir, nodeFileSystem).write(
      newMemory(validContent({ kind: "fact", title: "Seeded", body: "From disk." }), {
        id: memoryId("01JB8Z6Q4R3M2N1P0V9W8X0001"),
        scope: { level: "user" },
        now: new Date("2026-03-01T10:00:00.000Z"),
      }),
    );

    await activateOnce(env, 1);
    rmSync(join(dataDir, "cache.sqlite"));
    await activateOnce(env, 2);

    expect(syncedCounts(env)).toEqual([
      { indexed: 1, removed: 0 },
      { indexed: 1, removed: 0 },
    ]);
    expect(existsSync(join(dataDir, "cache.sqlite"))).toBe(true);
  });

  test("dispose reaches the runtime and releases the store without errors", async () => {
    const env = liveEnvWithWaymark();
    const server = await env.serve();
    try {
      await server.newSession();
      await waitUntil(() => syncedCounts(env).length > 0);
      const response = await server.api("/instance/dispose", { method: "POST" });
      expect(response.ok).toBe(true);
      await waitUntil(() => probeLines(env, "runtime disposed").length > 0);
    } finally {
      await server.stop();
    }

    expect(probeLines(env, "hook failed")).toEqual([]);
    expect(probeLines(env, "activation failed")).toEqual([]);
  });
});

describe("memory tools through the agent", () => {
  test("memory_save called by the agent writes a user memory file", async () => {
    const env = liveEnvWithWaymark();

    await env.run(
      "Call the memory_save tool once with kind fact, scope user, title Staging resets nightly, body All data is wiped at 02:00. Then say DONE.",
    );

    const factDir = join(env.dataHome, "waymark", "user", "fact");
    expect(existsSync(factDir) ? readdirSync(factDir) : []).toHaveLength(1);
  });
});

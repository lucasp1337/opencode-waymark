import { afterEach, describe, expect, test } from "bun:test";
import { memoryId } from "../../../../test/memory-id";
import { rethrowCacheFailure } from "../../../../test/rethrow-cache-failure";
import { useTempDirs } from "../../../../test/temp-dir";
import { validContent } from "../../../../test/valid-content";
import { type Memory, newMemory } from "../../model/memory";
import type { ScopeRef } from "../../model/scope";
import type { ToolCallInfo } from "../../port";
import { nodeFileSystem } from "../../store/fs";
import { type MemoryStore, openMemoryStore } from "../../store/memory-store";
import { createJit } from "./jit";

const USER: ScopeRef = { level: "user" };
const tempRoot = useTempDirs();
const opened: MemoryStore[] = [];

afterEach(() => {
  for (const store of opened.splice(0)) {
    store.close();
  }
});

function openStore(root: string): MemoryStore {
  const { store } = openMemoryStore(root, nodeFileSystem, { onCacheFailure: rethrowCacheFailure });
  opened.push(store);
  return store;
}

function gotcha(n: number): Memory {
  return newMemory(
    validContent({
      kind: "gotcha",
      title: `Gotcha ${n}`,
      body: "Body.",
      triggers: { tools: ["bash"] },
    }),
    { id: memoryId(`01JB8Z6Q4R3M2N1P0V9W8X000${n}`), scope: USER, now: new Date(0) },
  );
}

function bashCall(sessionID: string): ToolCallInfo {
  return { sessionID, tool: "bash", args: {}, touchedPaths: [], appendable: true };
}

function jitOver(store: MemoryStore) {
  return createJit({
    store,
    counters: { recordFire: () => undefined, firesWithin: () => 0 },
    noisy: { fires: 10, days: 30 },
    recallScope: () => Promise.resolve({ chain: [USER], directory: "/work" }),
  });
}

// opencode runs one plugin instance per directory, all on one cache file.
describe("JIT with several plugin instances on one data directory", () => {
  test("delivers a gotcha another instance saved after the first call", async () => {
    const root = tempRoot();
    const jit = jitOver(openStore(root));
    expect(await jit.onToolAfter(bashCall("s1"))).toBeNull();

    openStore(root).save(gotcha(1));

    expect(await jit.onToolAfter(bashCall("s2"))).toContain("Gotcha 1");
  });

  test("stops delivering a gotcha another instance forgot", async () => {
    const root = tempRoot();
    const other = openStore(root);
    other.save(gotcha(1));
    const jit = jitOver(openStore(root));
    expect(await jit.onToolAfter(bashCall("s1"))).toContain("Gotcha 1");

    other.forget(gotcha(1));

    expect(await jit.onToolAfter(bashCall("s2"))).toBeNull();
  });
});

describe("generation across instances", () => {
  test("stays put while no instance writes", () => {
    const store = openStore(tempRoot());
    const before = store.generation();

    expect(store.generation()).toBe(before);
  });
});

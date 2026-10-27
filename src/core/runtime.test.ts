import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeHost } from "../../test/fake-host";
import { memoryId } from "../../test/memory-id";
import { FIRST_ID as ID, type RuntimeFixture, useRuntime } from "../../test/runtime-fixture";
import { useTempDirs } from "../../test/temp-dir";
import { validContent } from "../../test/valid-content";
import { newMemory } from "./model/memory";
import { activate } from "./runtime";
import { processGit } from "./scope/git";
import { nodeFileSystem } from "./store/fs";
import { createMemoryFiles } from "./store/memory-files";

const runtime = useRuntime();

function seedFact(dataDir: string): string {
  return createMemoryFiles(dataDir, nodeFileSystem).write(
    newMemory(validContent({ kind: "fact", title: "Seeded", body: "From disk." }), {
      id: memoryId(ID),
      scope: { level: "user" },
      now: new Date("2026-03-01T10:00:00.000Z"),
    }),
  );
}

function syncLogs(fx: RuntimeFixture): unknown[] {
  return fx.host.logs.filter((entry) => entry.msg === "memory cache synced").map((e) => e.data);
}

describe("createRuntime", () => {
  test("registers the memory tools", () => {
    const fx = runtime();

    expect([...fx.host.tools.keys()]).toEqual(TOOLS);
  });

  test("indexes the memory files it finds and logs the count", () => {
    const fx = runtime();
    seedFact(fx.dataDir);

    const next = fx.restart();

    expect(syncLogs(next)).toEqual([{ indexed: 1, removed: 0 }]);
  });

  test("a deleted cache is rebuilt from the files on the next activation", () => {
    const fx = runtime();
    seedFact(fx.dataDir);
    const indexed = fx.restart();
    rmSync(join(indexed.dataDir, "cache.sqlite"));

    const rebuilt = indexed.restart();

    expect(syncLogs(rebuilt)).toEqual([{ indexed: 1, removed: 0 }]);
  });

  test("an unchanged store is not re-read on the next activation", () => {
    const fx = runtime();
    seedFact(fx.dataDir);
    const indexed = fx.restart();

    const again = indexed.restart();

    expect(syncLogs(again)).toEqual([{ indexed: 0, removed: 0 }]);
  });

  test("a hand-edited memory file is re-read on the next activation", () => {
    const fx = runtime();
    const file = seedFact(fx.dataDir);
    const indexed = fx.restart();
    utimesSync(file, new Date("2030-01-01"), new Date("2030-01-01"));

    const again = indexed.restart();

    expect(syncLogs(again)).toEqual([{ indexed: 1, removed: 0 }]);
  });

  test("an unusable cache file is recreated and logged", () => {
    const fx = runtime();
    seedFact(fx.dataDir);
    fx.runtime.dispose();
    writeFileSync(join(fx.dataDir, "cache.sqlite"), "not a database ".repeat(40));

    const next = fx.restart();

    expect(next.host.logs.map((entry) => entry.msg)).toContain("memory cache recreated");
    expect(syncLogs(next)).toEqual([{ indexed: 1, removed: 0 }]);
  });

  test("an invalid memory file is skipped and logged", () => {
    const fx = runtime();
    mkdirSync(join(fx.dataDir, "user", "fact"), { recursive: true });
    writeFileSync(join(fx.dataDir, "user", "fact", `${ID}.md`), "not a memory");

    const next = fx.restart();

    expect(next.host.logs.filter((entry) => entry.msg === "memory file skipped")).toHaveLength(1);
  });

  test("dispose releases the store once even when called twice", () => {
    const fx = runtime();

    fx.runtime.dispose();
    fx.runtime.dispose();

    expect(fx.host.logs.filter((entry) => entry.msg === "runtime disposed")).toHaveLength(1);
  });
});

const TOOLS: string[] = [];

const tempDir = useTempDirs();

describe("activate", () => {
  test("a failed start is logged and leaves an inert runtime with no tools", () => {
    const host = createFakeHost();
    const blocked = join(tempDir(), "file");
    writeFileSync(blocked, "a file where the data dir should be");

    const started = activate(host, {
      dataDir: join(blocked, "waymark"),
      fs: nodeFileSystem,
      git: processGit,
      now: () => new Date(0),
      newId: () => memoryId(ID),
    });

    expect(host.logs.map((entry) => entry.msg)).toEqual(["activation failed"]);
    expect(host.tools.size).toBe(0);
    expect(() => started.dispose()).not.toThrow();
  });
});

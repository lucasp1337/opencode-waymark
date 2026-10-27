import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeEmbedder } from "../../test/fake-embedder";
import { createFakeHost } from "../../test/fake-host";
import { memoryId } from "../../test/memory-id";
import {
  FIRST_ID as ID,
  type RuntimeFixture,
  SESSION,
  useRuntime,
} from "../../test/runtime-fixture";
import { useTempDirs } from "../../test/temp-dir";
import { validContent } from "../../test/valid-content";
import { newMemory } from "./model/memory";
import { activate, type RuntimeDeps } from "./runtime";
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

  test("an unusable vector file is recreated and logged", () => {
    const fx = runtime();
    fx.runtime.dispose();
    writeFileSync(join(fx.dataDir, "vectors.sqlite"), "not a database ".repeat(40));

    const next = fx.restart();

    expect(next.host.logs.map((entry) => entry.msg)).toContain("vector cache recreated");
  });

  test("an unusable telemetry file is recreated and logged", () => {
    const fx = runtime();
    fx.runtime.dispose();
    writeFileSync(join(fx.dataDir, "telemetry.sqlite"), "not a database ".repeat(40));

    const next = fx.restart();

    expect(next.host.logs.map((entry) => entry.msg)).toContain("telemetry recreated");
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

// SQLite deletes the write-ahead log when the last connection to the file closes, so its presence
// shows that a connection is still open.
describe("dispose and the telemetry file", () => {
  test("closes the telemetry connection", () => {
    const fx = runtime();
    const log = join(fx.dataDir, "telemetry.sqlite-wal");
    const openBefore = existsSync(log);

    fx.runtime.dispose();

    expect(openBefore).toBe(true);
    expect(existsSync(log)).toBe(false);
  });
});

describe("dispose with a loaded embedding model", () => {
  const closing = { count: 0 };
  const withModel = useRuntime({
    embedder: {
      ...fakeEmbedder([["anything"]]),
      close: () => {
        closing.count += 1;
      },
    },
  });

  test("closes the model once", async () => {
    closing.count = 0;
    const fx = withModel();
    // The first search starts the model load; the second sees it loaded.
    await fx.host.callTool("memory_search", { query: "anything" }, SESSION);
    await fx.host.callTool("memory_search", { query: "anything" }, SESSION);

    fx.runtime.dispose();
    fx.runtime.dispose();

    expect(closing.count).toBe(1);
  });
});

const TOOLS = [
  "memory_save",
  "memory_update",
  "memory_read",
  "memory_search",
  "memory_forget",
  "memory_config",
  "memory_command",
];

const tempDir = useTempDirs();

function depsIn(dataDir: string): RuntimeDeps {
  return {
    dataDir,
    fs: nodeFileSystem,
    git: processGit,
    now: () => new Date(0),
    newId: () => memoryId(ID),
    loadEmbedder: () => Promise.reject(new Error("no model in this test")),
    options: undefined,
  };
}

describe("activate", () => {
  test("a failed start is logged and leaves an inert runtime with no tools", () => {
    const host = createFakeHost();
    const blocked = join(tempDir(), "file");
    writeFileSync(blocked, "a file where the data dir should be");

    const started = activate(host, depsIn(join(blocked, "waymark")));

    expect(host.logs.map((entry) => entry.msg)).toEqual(["activation failed"]);
    expect(host.tools.size).toBe(0);
    expect(() => started.dispose()).not.toThrow();
  });

  test("a start that fails after the telemetry file was opened closes it again", () => {
    const dataDir = tempDir();
    const host = {
      ...createFakeHost(),
      registerTool: () => {
        throw new Error("host refused the tool");
      },
    };

    activate(host, depsIn(dataDir));

    expect(host.logs.map((entry) => entry.msg)).toContain("activation failed");
    expect(existsSync(join(dataDir, "telemetry.sqlite"))).toBe(true);
    expect(existsSync(join(dataDir, "telemetry.sqlite-wal"))).toBe(false);
  });
});

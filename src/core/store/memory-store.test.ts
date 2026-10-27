import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { memoryId } from "../../../test/memory-id";
import { useTempDirs } from "../../../test/temp-dir";
import { validContent } from "../../../test/valid-content";
import { type Memory, newMemory } from "../model/memory";
import type { ScopeRef } from "../model/scope";
import { type FileSystem, nodeFileSystem } from "./fs";
import { createMemoryFiles } from "./memory-files";
import { MemoryFileMissingError, type MemoryStore, openMemoryStore } from "./memory-store";

const USER: ScopeRef = { level: "user" };
const REPO: ScopeRef = { level: "repo", id: "github.com/acme/api" };
const CHAIN = [USER, REPO];

// Later than any file written during a test run, so a rewrite stamped with it counts as an edit.
const EDITED_AT = new Date("2100-01-01T00:00:00.000Z");
const UPDATED_LATER = "2026-06-01T00:00:00.000Z";

const tempRoot = useTempDirs();
const opened: MemoryStore[] = [];

afterEach(() => {
  for (const store of opened.splice(0)) {
    store.close();
  }
});

function fixture(n: number, scope: ScopeRef = USER, title = `Memory ${n}`): Memory {
  return newMemory(validContent({ kind: "fact", title, body: "deploy notes" }), {
    id: memoryId(`01JB8Z6Q4R3M2N1P0V9W8X7Y6${n}`),
    scope,
    now: new Date("2026-01-02T03:04:05.000Z"),
  });
}

function titles(memories: readonly Memory[]): string[] {
  return memories.map((memory) => memory.title);
}

function openStore(root: string, fs: FileSystem = nodeFileSystem) {
  const result = openMemoryStore(root, fs);
  opened.push(result.store);
  return result;
}

function memoryFiles(root: string) {
  return createMemoryFiles(root, nodeFileSystem);
}

function fileExists(path: string): boolean {
  return nodeFileSystem.readText(path) !== undefined;
}

// Leaves the cache unable to decode any memory it holds.
function damageCachedText(root: string): void {
  const db = new Database(join(root, "cache.sqlite"));
  try {
    db.exec("UPDATE memories SET source = 'garbage'");
  } finally {
    db.close();
  }
}

function countingFileSystem() {
  const reads: string[] = [];
  const fs: FileSystem = {
    ...nodeFileSystem,
    readText(path) {
      reads.push(path);
      return nodeFileSystem.readText(path);
    },
  };
  return { fs, reads };
}

describe("openMemoryStore", () => {
  test("creates the data root when it does not exist", () => {
    const root = join(tempRoot(), "data", "waymark");

    openStore(root);

    expect(existsSync(join(root, "cache.sqlite"))).toBe(true);
  });

  test("indexes the memory files that are already there", () => {
    const root = tempRoot();
    memoryFiles(root).write(fixture(1));
    memoryFiles(root).write(fixture(2, REPO));

    const { store, report } = openStore(root);

    expect(report).toEqual({ indexed: 2, removed: 0, invalid: [] });
    expect(titles(store.inScopes(CHAIN))).toEqual(["Memory 1", "Memory 2"]);
  });

  test("reports files it cannot index", () => {
    const root = tempRoot();
    const path = memoryFiles(root).write(fixture(1));
    writeFileSync(path, "damaged");

    const { report } = openStore(root);

    expect(report.invalid.map((problem) => problem.path)).toEqual([path]);
  });

  test("rebuilds the same results after the cache file is deleted", () => {
    const root = tempRoot();
    const first = openStore(root).store;
    first.save(fixture(1));
    first.save(fixture(2, REPO));
    const expected = titles(first.related({ text: "deploy", scopes: CHAIN, limit: 3 }));
    first.close();
    rmSync(join(root, "cache.sqlite"));

    const { store, report } = openStore(root);

    expect(report.indexed).toBe(2);
    expect(titles(store.related({ text: "deploy", scopes: CHAIN, limit: 3 }))).toEqual(expected);
    expect(store.get(fixture(1).id)).toEqual(fixture(1));
  });

  test("recreates a cache file that is not a database and says why", () => {
    const root = tempRoot();
    memoryFiles(root).write(fixture(1));
    writeFileSync(join(root, "cache.sqlite"), "garbage, not a database. ".repeat(20));

    const { store, report, cacheReset } = openStore(root);

    expect(cacheReset).toContain("file is not a database");
    expect(report.indexed).toBe(1);
    expect(titles(store.inScopes(CHAIN))).toEqual(["Memory 1"]);
    expect(memoryFiles(root).listPaths()).toHaveLength(1);
  });

  test("reports no cache reset when the cache opens normally", () => {
    const { cacheReset } = openStore(tempRoot());

    expect(cacheReset).toBeUndefined();
  });

  test("re-reads no file when the cache is intact", () => {
    const root = tempRoot();
    const first = openStore(root).store;
    first.save(fixture(1));
    first.close();
    const counting = countingFileSystem();

    const { report } = openStore(root, counting.fs);

    expect(report.indexed).toBe(0);
    expect(counting.reads).toEqual([]);
  });

  test("picks up a file edited while the store was closed", () => {
    const root = tempRoot();
    const first = openStore(root).store;
    first.save(fixture(1, USER, "Before"));
    first.close();
    const path = memoryFiles(root).write(fixture(1, USER, "After"));
    utimesSync(path, EDITED_AT, EDITED_AT);

    const { store } = openStore(root);

    expect(store.get(fixture(1).id)?.title).toBe("After");
  });
});

describe("save", () => {
  test("stores the memory and writes its file under the scope directory", () => {
    const root = tempRoot();
    const { store } = openStore(root);

    store.save(fixture(1, REPO));

    const path = join(
      root,
      "repos",
      "github.com",
      "acme",
      "api",
      "fact",
      "01JB8Z6Q4R3M2N1P0V9W8X7Y61.md",
    );
    expect(fileExists(path)).toBe(true);
    expect(store.get(fixture(1).id)).toEqual(fixture(1, REPO));
  });

  test("makes the memory searchable", () => {
    const { store } = openStore(tempRoot());

    store.save(fixture(1));

    expect(titles(store.related({ text: "deploy", scopes: CHAIN, limit: 3 }))).toEqual([
      "Memory 1",
    ]);
  });

  test("saving the same memory again updates it in place", () => {
    const root = tempRoot();
    const { store } = openStore(root);
    store.save(fixture(1, USER, "Before"));

    store.save(fixture(1, USER, "After"));

    expect(store.get(fixture(1).id)?.title).toBe("After");
    expect(memoryFiles(root).listPaths()).toHaveLength(1);
  });

  test("moves the file when the kind changes", () => {
    const root = tempRoot();
    const { store } = openStore(root);
    const original = fixture(1);
    store.save(original);

    store.save({ ...original, kind: "preference" });

    expect(fileExists(join(root, "user", "fact", `${original.id}.md`))).toBe(false);
    expect(fileExists(join(root, "user", "preference", `${original.id}.md`))).toBe(true);
    expect(store.get(original.id)?.kind).toBe("preference");
  });

  test("moves the file when the scope changes", () => {
    const root = tempRoot();
    const { store } = openStore(root);
    const original = fixture(1);
    store.save(original);

    store.save({ ...original, scope: REPO });

    expect(fileExists(join(root, "user", "fact", `${original.id}.md`))).toBe(false);
    expect(memoryFiles(root).listPaths()).toHaveLength(1);
    expect(store.inScopes([USER])).toEqual([]);
    expect(titles(store.inScopes([REPO]))).toEqual(["Memory 1"]);
  });

  test("never deletes a file when the kind or scope changes", () => {
    const refusingDeletes: FileSystem = {
      ...nodeFileSystem,
      remove: () => {
        throw new Error("save must not delete");
      },
    };
    const root = tempRoot();
    const { store } = openStore(root, refusingDeletes);
    const original = fixture(1);
    store.save(original);

    store.save({ ...original, kind: "preference" });
    store.save({ ...original, kind: "preference", scope: REPO });

    expect(store.get(original.id)?.scope).toEqual(REPO);
    expect(memoryFiles(root).listPaths()).toHaveLength(1);
  });

  test("saves when the cached location of the memory no longer holds a file", () => {
    const root = tempRoot();
    const { store } = openStore(root);
    const original = fixture(1);
    store.save(original);
    nodeFileSystem.remove(join(root, "user", "fact", `${original.id}.md`));

    store.save({ ...original, kind: "preference" });

    expect(fileExists(join(root, "user", "preference", `${original.id}.md`))).toBe(true);
    expect(store.get(original.id)?.kind).toBe("preference");
  });

  test("still saves when the cache cannot tell where the memory was", () => {
    const root = tempRoot();
    const { store } = openStore(root);
    const original = fixture(1);
    store.save(original);
    const oldPath = join(root, "user", "fact", `${original.id}.md`);
    damageCachedText(root);

    store.save({ ...original, kind: "preference", updated: UPDATED_LATER });

    expect(fileExists(join(root, "user", "preference", `${original.id}.md`))).toBe(true);
    expect(store.get(original.id)?.kind).toBe("preference");
    expect(fileExists(oldPath)).toBe(true);
  });

  test("a file left behind by such a save loses to the newer one when the store reopens", () => {
    const root = tempRoot();
    const first = openStore(root).store;
    const original = fixture(1);
    first.save(original);
    const oldPath = join(root, "user", "fact", `${original.id}.md`);
    damageCachedText(root);
    first.save({ ...original, kind: "preference", updated: UPDATED_LATER });
    first.close();

    const { store, report } = openStore(root);

    expect(store.get(original.id)?.kind).toBe("preference");
    expect(report.invalid).toEqual([{ path: oldPath, error: `duplicate id ${original.id}` }]);
  });

  test("does not hide a failure of the cache that is not damage", () => {
    const { store } = openStore(tempRoot());
    store.close();

    expect(() => store.save(fixture(1))).toThrow();
  });

  test("fails when the file is gone right after it was written", () => {
    const vanishing: FileSystem = { ...nodeFileSystem, mtimeMs: () => undefined };
    const { store } = openStore(tempRoot(), vanishing);

    expect(() => store.save(fixture(1))).toThrow(MemoryFileMissingError);
  });
});

describe("forget", () => {
  test("removes the file and the cached memory", () => {
    const root = tempRoot();
    const { store } = openStore(root);
    store.save(fixture(1));

    store.forget(fixture(1));

    expect(store.get(fixture(1).id)).toBeUndefined();
    expect(store.related({ text: "deploy", scopes: CHAIN, limit: 3 })).toEqual([]);
    expect(memoryFiles(root).listPaths()).toEqual([]);
  });

  test("leaves other memories in place", () => {
    const root = tempRoot();
    const { store } = openStore(root);
    store.save(fixture(1));
    store.save(fixture(2));

    store.forget(fixture(1));

    expect(titles(store.inScopes(CHAIN))).toEqual(["Memory 2"]);
    expect(memoryFiles(root).listPaths()).toHaveLength(1);
  });

  test("a forgotten memory does not come back when the cache is rebuilt", () => {
    const root = tempRoot();
    const first = openStore(root).store;
    first.save(fixture(1));
    first.forget(fixture(1));
    first.close();
    rmSync(join(root, "cache.sqlite"));

    const { store } = openStore(root);

    expect(store.get(fixture(1).id)).toBeUndefined();
  });
});

describe("get", () => {
  test("returns undefined for an id that was never saved", () => {
    const { store } = openStore(tempRoot());

    expect(store.get(fixture(1).id)).toBeUndefined();
  });
});

describe("generation", () => {
  test("changes with every save and forget, and not on reads", () => {
    const { store } = openStore(tempRoot());
    const start = store.generation();

    store.save(fixture(1));
    const afterSave = store.generation();
    store.inScopes(CHAIN);
    const afterRead = store.generation();
    store.forget(fixture(1));

    expect(afterSave).not.toBe(start);
    expect(afterRead).toBe(afterSave);
    expect(store.generation()).not.toBe(afterSave);
  });
});

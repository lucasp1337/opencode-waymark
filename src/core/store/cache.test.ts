import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { memoryId } from "../../../test/memory-id";
import { useTempDirs } from "../../../test/temp-dir";
import { validContent } from "../../../test/valid-content";
import { type Memory, newMemory } from "../model/memory";
import { ownField } from "../model/own-field";
import type { ScopeRef } from "../model/scope";
import { type MemoryCache, openCache, openSyncedCache } from "./cache";
import { CacheCorruptError } from "./derived-database";
import { type FileSystem, nodeFileSystem } from "./fs";
import { createMemoryFiles, type MemoryFiles } from "./memory-files";

const USER: ScopeRef = { level: "user" };
const REPO: ScopeRef = { level: "repo", id: "github.com/acme/api" };
const OTHER_REPO: ScopeRef = { level: "repo", id: "github.com/acme/web" };
const CHAIN = [USER, REPO];

const CREATED = "2026-01-02T03:04:05.000Z";
const INDEXED_AT = new Date("2026-02-01T00:00:00.000Z");
const EDITED_AT = new Date("2026-02-02T00:00:00.000Z");
const LATER = "2026-06-01T00:00:00.000Z";
// Accented letters, so its precomposed and decomposed spellings differ.
const KOREN = "kore\u0148ov\u00fd";

const tempRoot = useTempDirs();
const openCaches: MemoryCache[] = [];

afterEach(() => {
  for (const cache of openCaches.splice(0)) {
    cache.close();
  }
});

interface Fixture {
  readonly n: number;
  readonly scope?: ScopeRef;
  readonly kind?: "fact" | "preference";
  readonly title?: string;
  readonly body?: string;
  readonly created?: string;
  readonly updated?: string;
}

function fixture({
  n,
  scope = USER,
  kind = "fact",
  title = `Memory ${n}`,
  body = "body",
  created = CREATED,
  updated = created,
}: Fixture): Memory {
  const memory = newMemory(validContent({ kind, title, body }), {
    id: memoryId(`01JB8Z6Q4R3M2N1P0V9W8X7Y6${n}`),
    scope,
    now: new Date(created),
  });
  return { ...memory, updated };
}

function titles(memories: readonly Memory[]): string[] {
  return memories.map((memory) => memory.title);
}

// For tests that never look at the file behind a memory.
function putAnywhere(cache: MemoryCache, memory: Memory): void {
  cache.put(memory, `/data/${memory.id}.md`, 1);
}

function dbFile(root: string): string {
  return join(root, "cache.sqlite");
}

function openIn(root: string): MemoryCache {
  const { cache } = openCache(dbFile(root));
  openCaches.push(cache);
  return cache;
}

function openSynced(root: string, files: MemoryFiles) {
  const synced = openSyncedCache(dbFile(root), files);
  openCaches.push(synced.cache);
  return synced;
}

function setup(fs: FileSystem = nodeFileSystem) {
  const root = tempRoot();
  return { root, files: createMemoryFiles(root, fs), cache: openIn(root) };
}

// A fixed modification time stands in for "when the file was last changed".
function writeAt(files: MemoryFiles, memory: Memory, at = INDEXED_AT): string {
  const path = files.write(memory);
  utimesSync(path, at, at);
  return path;
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

function withDatabase(file: string, run: (db: Database) => void): void {
  const db = new Database(file);
  try {
    run(db);
  } finally {
    db.close();
  }
}

describe("sync", () => {
  test("indexes every memory file and reports what it did", () => {
    const { files, cache } = setup();
    writeAt(files, fixture({ n: 1 }));
    writeAt(files, fixture({ n: 2, scope: REPO }));
    writeAt(files, fixture({ n: 3, scope: OTHER_REPO }));

    const report = cache.sync(files);

    expect(report).toEqual({ indexed: 3, removed: 0, invalid: [] });
    expect(titles(cache.inScopes([USER, REPO, OTHER_REPO]))).toEqual([
      "Memory 1",
      "Memory 2",
      "Memory 3",
    ]);
  });

  test("re-reads nothing when no file changed", () => {
    const counting = countingFileSystem();
    const { files, cache } = setup(counting.fs);
    writeAt(files, fixture({ n: 1 }));
    writeAt(files, fixture({ n: 2 }));
    cache.sync(files);
    counting.reads.length = 0;

    const report = cache.sync(files);

    expect(report).toEqual({ indexed: 0, removed: 0, invalid: [] });
    expect(counting.reads).toEqual([]);
  });

  test("re-reads a file whose modification time is newer than its row", () => {
    const { files, cache } = setup();
    const original = fixture({ n: 1, title: "Before" });
    const path = writeAt(files, original);
    cache.sync(files);
    writeAt(files, fixture({ n: 1, title: "After" }), EDITED_AT);

    const report = cache.sync(files);

    expect(report.indexed).toBe(1);
    expect(cache.get(original.id)?.memory.title).toBe("After");
    expect(cache.get(original.id)?.path).toBe(path);
  });

  test("re-reads a file whose modification time is older than its row", () => {
    const { files, cache } = setup();
    const original = fixture({ n: 1, title: "Before" });
    writeAt(files, original, EDITED_AT);
    cache.sync(files);
    writeAt(files, fixture({ n: 1, title: "Restored" }), INDEXED_AT);

    const report = cache.sync(files);

    expect(report.indexed).toBe(1);
    expect(cache.get(original.id)?.memory.title).toBe("Restored");
  });

  test("keeps the row of a file whose modification time did not change", () => {
    const { files, cache } = setup();
    const original = fixture({ n: 1, title: "Before" });
    writeAt(files, original);
    cache.sync(files);
    writeAt(files, fixture({ n: 1, title: "After" }), INDEXED_AT);

    const report = cache.sync(files);

    expect(report.indexed).toBe(0);
    expect(cache.get(original.id)?.memory.title).toBe("Before");
  });

  test("drops the row of a file that was deleted", () => {
    const { files, cache } = setup();
    const gone = fixture({ n: 1, title: "Gone" });
    writeAt(files, gone);
    writeAt(files, fixture({ n: 2, title: "Kept" }));
    cache.sync(files);
    files.removeAll(gone.id);

    const report = cache.sync(files);

    expect(report).toEqual({ indexed: 0, removed: 1, invalid: [] });
    expect(titles(cache.inScopes(CHAIN))).toEqual(["Kept"]);
    expect(cache.get(gone.id)).toBeUndefined();
    expect(titles(cache.related({ text: "body", scopes: CHAIN, limit: 10 }))).toEqual(["Kept"]);
  });

  test("reports a file that cannot be decoded and does not index it", () => {
    const { root, files, cache } = setup();
    writeAt(files, fixture({ n: 1 }));
    const broken = join(root, "user", "fact", "broken.md");
    writeFileSync(broken, "no frontmatter here");

    const report = cache.sync(files);

    expect(report.indexed).toBe(1);
    expect(report.invalid.map((problem) => problem.path)).toEqual([broken]);
    expect(report.invalid.map((problem) => problem.error).join()).toContain(
      "missing opening --- line",
    );
    expect(titles(cache.inScopes(CHAIN))).toEqual(["Memory 1"]);
  });

  test("drops the row of a file that became undecodable", () => {
    const { files, cache } = setup();
    const memory = fixture({ n: 1 });
    const path = writeAt(files, memory);
    cache.sync(files);
    writeFileSync(path, "damaged");
    utimesSync(path, EDITED_AT, EDITED_AT);

    const report = cache.sync(files);

    expect(report.removed).toBe(1);
    expect(report.invalid.map((problem) => problem.path)).toEqual([path]);
    expect(cache.get(memory.id)).toBeUndefined();
  });

  test("indexes the first path of two files with the same id and update time", () => {
    const { files, cache } = setup();
    const fact = fixture({ n: 1, kind: "fact" });
    writeAt(files, fact);
    const preferencePath = writeAt(files, fixture({ n: 1, kind: "preference" }));

    const report = cache.sync(files);

    expect(report.invalid).toEqual([{ path: preferencePath, error: `duplicate id ${fact.id}` }]);
    expect(cache.get(fact.id)?.memory.kind).toBe("fact");
  });

  test("indexes the most recently updated of two files with the same id", () => {
    const { files, cache } = setup();
    const fact = fixture({ n: 1, kind: "fact" });
    const factPath = writeAt(files, fact);
    writeAt(files, fixture({ n: 1, kind: "preference", updated: LATER }));

    const report = cache.sync(files);

    expect(report.invalid).toEqual([{ path: factPath, error: `duplicate id ${fact.id}` }]);
    expect(cache.get(fact.id)?.memory.kind).toBe("preference");
  });

  test("keeps a cached file that was updated more recently than a duplicate that appears", () => {
    const { files, cache } = setup();
    const preference = fixture({ n: 1, kind: "preference", updated: LATER });
    writeAt(files, preference);
    cache.sync(files);
    const factPath = writeAt(files, fixture({ n: 1, kind: "fact" }));

    const report = cache.sync(files);

    expect(report).toEqual({
      indexed: 0,
      removed: 0,
      invalid: [{ path: factPath, error: `duplicate id ${preference.id}` }],
    });
    expect(cache.get(preference.id)?.memory.kind).toBe("preference");
  });

  test("replaces a cached file by a duplicate that sorts first when their update times are equal", () => {
    const { files, cache } = setup();
    const preference = fixture({ n: 1, kind: "preference" });
    const preferencePath = writeAt(files, preference);
    cache.sync(files);
    writeAt(files, fixture({ n: 1, kind: "fact" }));

    const report = cache.sync(files);

    expect(report.invalid.map((problem) => problem.path)).toEqual([preferencePath]);
    expect(cache.get(preference.id)?.memory.kind).toBe("fact");
  });

  test("ignores a file that disappears after it was listed", () => {
    const { root, files, cache } = setup();
    writeAt(files, fixture({ n: 1 }));
    const ghost = join(root, "user", "fact", "ghost.md");
    const listingGhost: MemoryFiles = { ...files, listPaths: () => [...files.listPaths(), ghost] };

    const report = cache.sync(listingGhost);

    expect(report).toEqual({ indexed: 1, removed: 0, invalid: [] });
  });
});

describe("persistence", () => {
  test("a reopened cache re-reads nothing", () => {
    const { root, files, cache } = setup();
    writeAt(files, fixture({ n: 1 }));
    cache.sync(files);
    cache.close();
    const counting = countingFileSystem();

    const report = openIn(root).sync(createMemoryFiles(root, counting.fs));

    expect(report.indexed).toBe(0);
    expect(counting.reads).toEqual([]);
  });

  test("rebuilds every row from the files when the database file is gone", () => {
    const { root, files, cache } = setup();
    writeAt(files, fixture({ n: 1, title: "Staging resets nightly" }));
    writeAt(files, fixture({ n: 2, scope: REPO }));
    cache.sync(files);
    cache.close();
    rmSync(dbFile(root));

    const rebuilt = openIn(root);
    const report = rebuilt.sync(files);

    expect(report.indexed).toBe(2);
    expect(titles(rebuilt.inScopes(CHAIN))).toEqual(["Staging resets nightly", "Memory 2"]);
    expect(titles(rebuilt.related({ text: "staging", scopes: CHAIN, limit: 3 }))).toEqual([
      "Staging resets nightly",
    ]);
  });

  test("rebuilds from the files when the database has another schema version", () => {
    const { root, files, cache } = setup();
    writeAt(files, fixture({ n: 1 }));
    cache.sync(files);
    cache.close();
    withDatabase(dbFile(root), (db) => db.exec("PRAGMA user_version = 99"));

    const reopened = openIn(root);
    const emptiedBeforeSync = reopened.inScopes(CHAIN);
    const report = reopened.sync(files);

    expect(emptiedBeforeSync).toEqual([]);
    expect(report.indexed).toBe(1);
  });

  test("records the schema version it rebuilt, so the next open keeps the rows", () => {
    const { root, files, cache } = setup();
    writeAt(files, fixture({ n: 1 }));
    cache.close();
    withDatabase(dbFile(root), (db) => db.exec("PRAGMA user_version = 99"));
    const rebuilt = openIn(root);
    rebuilt.sync(files);
    rebuilt.close();

    expect(titles(openIn(root).inScopes(CHAIN))).toEqual(["Memory 1"]);
  });
});

describe("related", () => {
  function searchable() {
    const { cache } = setup();
    return { cache, add: (memory: Memory) => putAnywhere(cache, memory) };
  }

  test("folds diacritics so plain text finds accented text", () => {
    const { cache, add } = searchable();
    add(fixture({ n: 1, title: "Layout", body: "koreňový adresár" }));

    expect(titles(cache.related({ text: "korenovy", scopes: CHAIN, limit: 3 }))).toEqual([
      "Layout",
    ]);
  });

  test("finds a precomposed word from its decomposed spelling", () => {
    const { cache, add } = searchable();
    add(fixture({ n: 1, body: KOREN.normalize("NFC") }));

    expect(
      titles(cache.related({ text: KOREN.normalize("NFD"), scopes: CHAIN, limit: 3 })),
    ).toEqual(["Memory 1"]);
  });

  test("finds a decomposed word from its precomposed spelling", () => {
    const { cache, add } = searchable();
    add(fixture({ n: 1, body: KOREN.normalize("NFD") }));

    expect(
      titles(cache.related({ text: KOREN.normalize("NFC"), scopes: CHAIN, limit: 3 })),
    ).toEqual(["Memory 1"]);
  });

  test("matches words in the title as well as in the body", () => {
    const { cache, add } = searchable();
    add(fixture({ n: 1, title: "Unicorn deployments", body: "details" }));

    expect(titles(cache.related({ text: "unicorn", scopes: CHAIN, limit: 3 }))).toEqual([
      "Unicorn deployments",
    ]);
  });

  test("ignores letter case in the query", () => {
    const { cache, add } = searchable();
    add(fixture({ n: 1, body: "deploy" }));

    expect(titles(cache.related({ text: "DEPLOY", scopes: CHAIN, limit: 3 }))).toEqual([
      "Memory 1",
    ]);
  });

  test("ranks the memory that matches more of the query first", () => {
    const { cache, add } = searchable();
    add(fixture({ n: 1, title: "Misc", body: "the deploy" }));
    add(fixture({ n: 2, title: "Deploy staging", body: "deploy to staging runs migrations" }));

    expect(titles(cache.related({ text: "deploy staging", scopes: CHAIN, limit: 3 }))).toEqual([
      "Deploy staging",
      "Misc",
    ]);
  });

  test("returns at most the limit", () => {
    const { cache, add } = searchable();
    add(fixture({ n: 1, body: "deploy" }));
    add(fixture({ n: 2, body: "deploy" }));
    add(fixture({ n: 3, body: "deploy" }));

    expect(cache.related({ text: "deploy", scopes: CHAIN, limit: 2 })).toHaveLength(2);
  });

  test("applies the kind filter before the limit", () => {
    const { cache, add } = searchable();
    for (const n of [1, 2, 3, 4]) {
      add(fixture({ n, kind: "fact", body: "deploy deploy deploy deploy" }));
    }
    add(fixture({ n: 5, kind: "preference", body: "deploy" }));

    const found = cache.related({
      text: "deploy",
      scopes: CHAIN,
      kinds: ["preference"],
      limit: 2,
    });

    expect(titles(found)).toEqual(["Memory 5"]);
  });

  test("matches any of several kinds", () => {
    const { cache, add } = searchable();
    add(fixture({ n: 1, kind: "fact", body: "deploy" }));
    add(fixture({ n: 2, kind: "preference", body: "deploy" }));

    const found = cache.related({
      text: "deploy",
      scopes: CHAIN,
      kinds: ["fact", "preference"],
      limit: 5,
    });

    expect(titles(found)).toEqual(["Memory 1", "Memory 2"]);
  });

  test("matches nothing when the kind filter is empty", () => {
    const { cache, add } = searchable();
    add(fixture({ n: 1, body: "deploy" }));

    expect(cache.related({ text: "deploy", scopes: CHAIN, kinds: [], limit: 5 })).toEqual([]);
  });

  test("ignores memories outside the given scopes", () => {
    const { cache, add } = searchable();
    add(fixture({ n: 1, scope: REPO, body: "deploy" }));
    add(fixture({ n: 2, scope: OTHER_REPO, body: "deploy" }));

    expect(titles(cache.related({ text: "deploy", scopes: [USER, REPO], limit: 3 }))).toEqual([
      "Memory 1",
    ]);
  });

  test("returns nothing for text without word tokens", () => {
    const { cache, add } = searchable();
    add(fixture({ n: 1, body: "deploy" }));

    expect(cache.related({ text: ' ?! -- "" ** ', scopes: CHAIN, limit: 3 })).toEqual([]);
  });

  test.each(['"', "*", "-", ":", "(", "^", "OR", "NOT", "NEAR("])(
    "treats %s in the query as plain text",
    (special) => {
      const { cache, add } = searchable();
      add(fixture({ n: 1, body: "deploy staging" }));

      expect(
        titles(cache.related({ text: `deploy ${special} staging`, scopes: CHAIN, limit: 3 })),
      ).toEqual(["Memory 1"]);
    },
  );

  test.each([
    [31, ["Memory 1"]],
    [32, []],
  ])("uses only the first 32 distinct words of the query: %d fillers", (fillers, expected) => {
    const { cache, add } = searchable();
    add(fixture({ n: 1, body: "zebra" }));
    const query = [...Array.from({ length: fillers }, (_, i) => `filler${i}`), "zebra"].join(" ");

    expect(titles(cache.related({ text: query, scopes: CHAIN, limit: 3 }))).toEqual(expected);
  });

  test("counts a repeated word once toward the 32-word cap", () => {
    const { cache, add } = searchable();
    add(fixture({ n: 1, body: "zebra" }));

    expect(
      titles(cache.related({ text: `${"alpha ".repeat(40)}zebra`, scopes: CHAIN, limit: 3 })),
    ).toEqual(["Memory 1"]);
  });
});

describe("inScopes", () => {
  test("returns only memories in the given scopes", () => {
    const { files, cache } = setup();
    writeAt(files, fixture({ n: 1 }));
    writeAt(files, fixture({ n: 2, scope: REPO }));
    writeAt(files, fixture({ n: 3, scope: OTHER_REPO }));
    cache.sync(files);

    expect(titles(cache.inScopes([USER, REPO]))).toEqual(["Memory 1", "Memory 2"]);
  });

  test("orders by creation time, then id", () => {
    const { cache } = setup();
    const later = "2026-03-01T00:00:00.000Z";
    for (const memory of [
      fixture({ n: 1, created: later }),
      fixture({ n: 3, created: CREATED }),
      fixture({ n: 2, created: CREATED }),
    ]) {
      putAnywhere(cache, memory);
    }

    expect(titles(cache.inScopes(CHAIN))).toEqual(["Memory 2", "Memory 3", "Memory 1"]);
  });
});

describe("an empty scope chain", () => {
  test("has no memories and no related ones", () => {
    const { cache } = setup();
    putAnywhere(cache, fixture({ n: 1, body: "deploy" }));

    expect(cache.inScopes([])).toEqual([]);
    expect(cache.related({ text: "deploy", scopes: [], limit: 3 })).toEqual([]);
  });

  test("is answered without querying the database", () => {
    const { cache } = setup();
    cache.close();

    expect(cache.inScopes([])).toEqual([]);
    expect(cache.related({ text: "deploy", scopes: [], limit: 3 })).toEqual([]);
  });
});

describe("get", () => {
  test("returns the memory with the path and modification time of its file", () => {
    const { cache } = setup();
    const memory = fixture({ n: 1, body: "Wiped at 02:00.\n" });
    cache.put(memory, "/data/a.md", 1);

    expect(cache.get(memory.id)).toEqual({ memory, path: "/data/a.md", mtimeMs: 1 });
  });

  test("returns undefined for an unknown id", () => {
    const { cache } = setup();

    expect(cache.get(fixture({ n: 1 }).id)).toBeUndefined();
  });
});

describe("put", () => {
  test("replaces the text of a memory that is stored again", () => {
    const { cache } = setup();
    cache.put(fixture({ n: 1, body: "alpha" }), "/data/a.md", 1);
    cache.put(fixture({ n: 1, body: "beta" }), "/data/a.md", 2);

    expect(cache.related({ text: "alpha", scopes: CHAIN, limit: 3 })).toEqual([]);
    expect(titles(cache.related({ text: "beta", scopes: CHAIN, limit: 3 }))).toEqual(["Memory 1"]);
    expect(cache.inScopes(CHAIN)).toHaveLength(1);
  });

  test("evicts the memory that held the same path", () => {
    const { cache } = setup();
    const evicted = fixture({ n: 1, body: "alpha" });
    const holder = fixture({ n: 2, body: "beta" });
    cache.put(evicted, "/data/shared.md", 1);
    cache.put(holder, "/data/shared.md", 2);

    expect(cache.get(evicted.id)).toBeUndefined();
    expect(cache.get(holder.id)?.path).toBe("/data/shared.md");
    expect(cache.related({ text: "alpha", scopes: CHAIN, limit: 3 })).toEqual([]);
  });

  test("moves a memory to its new path", () => {
    const { cache } = setup();
    const memory = fixture({ n: 1 });
    cache.put(memory, "/data/old.md", 1);
    cache.put(memory, "/data/new.md", 2);

    expect(cache.get(memory.id)?.path).toBe("/data/new.md");
  });
});

describe("delete", () => {
  test("removes the memory from lookups and search", () => {
    const { cache } = setup();
    const memory = fixture({ n: 1, body: "deploy" });
    cache.put(memory, "/data/a.md", 1);

    cache.delete(memory.id);

    expect(cache.get(memory.id)).toBeUndefined();
    expect(cache.inScopes(CHAIN)).toEqual([]);
    expect(cache.related({ text: "deploy", scopes: CHAIN, limit: 3 })).toEqual([]);
  });

  test("leaves other memories alone", () => {
    const { cache } = setup();
    const removed = fixture({ n: 1, body: "deploy" });
    cache.put(removed, "/data/a.md", 1);
    cache.put(fixture({ n: 2, body: "deploy" }), "/data/b.md", 1);

    cache.delete(removed.id);

    expect(titles(cache.related({ text: "deploy", scopes: CHAIN, limit: 3 }))).toEqual([
      "Memory 2",
    ]);
  });

  test("deleting an unknown id is not an error", () => {
    const { cache } = setup();

    expect(() => cache.delete(fixture({ n: 1 }).id)).not.toThrow();
  });
});

describe("a damaged cache", () => {
  function corrupt(root: string, assignment: string): void {
    withDatabase(dbFile(root), (db) => db.exec(`UPDATE memories SET ${assignment}`));
  }

  test("throws an error naming the memory whose stored text cannot be decoded", () => {
    const { root, cache } = setup();
    const memory = fixture({ n: 1 });
    cache.put(memory, "/data/a.md", 1);
    corrupt(root, "source = 'garbage'");

    expect(() => cache.get(memory.id)).toThrow(CacheCorruptError);
    expect(() => cache.get(memory.id)).toThrow(memory.id);
    expect(() => cache.inScopes(CHAIN)).toThrow(CacheCorruptError);
  });

  test("throws when a column does not hold what the schema promises", () => {
    const { root, cache } = setup();
    const memory = fixture({ n: 1 });
    cache.put(memory, "/data/a.md", 1);
    corrupt(root, "source = x'00'");

    expect(() => cache.get(memory.id)).toThrow("column source is not text");
  });
});

describe("a cache that is damaged after it was opened", () => {
  const PAGE = 4096;

  test("is rebuilt from the files when a row has a column of the wrong type", () => {
    const root = tempRoot();
    const files = createMemoryFiles(root, nodeFileSystem);
    writeAt(files, fixture({ n: 1 }));
    openSynced(root, files).cache.close();
    withDatabase(dbFile(root), (db) => db.exec("UPDATE memories SET mtime = 'soon'"));

    const { cache, report, reset } = openSynced(root, files);

    expect(reset).toContain("column mtime is not a number");
    expect(report.indexed).toBe(1);
    expect(titles(cache.inScopes(CHAIN))).toEqual(["Memory 1"]);
  });

  test("is rebuilt from the files when its pages are damaged", () => {
    const root = tempRoot();
    const files = createMemoryFiles(root, nodeFileSystem);
    for (const n of [1, 2, 3, 4, 5]) {
      writeAt(files, fixture({ n, body: "deploy ".repeat(2000) }));
    }
    openSynced(root, files).cache.close();
    const bytes = readFileSync(dbFile(root));
    writeFileSync(dbFile(root), bytes.fill(0xff, PAGE));

    const { cache, report, reset } = openSynced(root, files);

    expect(reset).toContain("malformed");
    expect(report.indexed).toBe(5);
    expect(cache.related({ text: "deploy", scopes: CHAIN, limit: 10 })).toHaveLength(5);
  });

  test("is not rebuilt for an error that does not come from the cache", () => {
    const root = tempRoot();
    const files = createMemoryFiles(root, nodeFileSystem);
    writeAt(files, fixture({ n: 1 }));
    openSynced(root, files).cache.close();
    const unlistable: MemoryFiles = {
      ...files,
      listPaths: () => {
        throw new Error("disk unavailable");
      },
    };

    expect(() => openSyncedCache(dbFile(root), unlistable)).toThrow("disk unavailable");
    expect(titles(openIn(root).inScopes(CHAIN))).toEqual(["Memory 1"]);
  });

  test("is rebuilt only once", () => {
    const root = tempRoot();
    let syncs = 0;
    const alwaysCorrupt: MemoryFiles = {
      ...createMemoryFiles(root, nodeFileSystem),
      listPaths: () => {
        syncs += 1;
        throw new CacheCorruptError("test", "is damaged");
      },
    };

    expect(() => openSyncedCache(dbFile(root), alwaysCorrupt)).toThrow(CacheCorruptError);
    expect(syncs).toBe(2);
  });
});

describe("sharing the cache file between processes", () => {
  test("uses a write-ahead log", () => {
    const { root } = setup();

    withDatabase(dbFile(root), (db) => {
      const row = db.query<unknown, []>("PRAGMA journal_mode").get();
      expect(ownField(row, "journal_mode")).toBe("wal");
    });
  });

  test("two handles see what the other stored and deleted", () => {
    const root = tempRoot();
    const first = openIn(root);
    const second = openIn(root);
    const memory = fixture({ n: 1, body: "deploy" });

    putAnywhere(first, memory);
    const seenBySecond = titles(second.related({ text: "deploy", scopes: CHAIN, limit: 3 }));
    second.delete(memory.id);

    expect(seenBySecond).toEqual(["Memory 1"]);
    expect(first.get(memory.id)).toBeUndefined();
    expect(first.related({ text: "deploy", scopes: CHAIN, limit: 3 })).toEqual([]);
  });
});

describe("an unusable cache file", () => {
  const GARBAGE = "garbage, not a database. ".repeat(20);

  test("is replaced and the reason reported", () => {
    const root = tempRoot();
    writeFileSync(dbFile(root), GARBAGE);

    const { cache, reset } = openCache(dbFile(root));
    openCaches.push(cache);

    expect(reset).toContain("file is not a database");
    expect(cache.inScopes(CHAIN)).toEqual([]);
  });

  test("is rebuilt from the memory files", () => {
    const root = tempRoot();
    const files = createMemoryFiles(root, nodeFileSystem);
    writeAt(files, fixture({ n: 1 }));
    writeFileSync(dbFile(root), GARBAGE);

    const { cache, report, reset } = openSynced(root, files);

    expect(reset).toContain("file is not a database");
    expect(report.indexed).toBe(1);
    expect(titles(cache.inScopes(CHAIN))).toEqual(["Memory 1"]);
  });

  test("is not reported as reset when it opens normally", () => {
    const root = tempRoot();

    const { cache, reset } = openSynced(root, createMemoryFiles(root, nodeFileSystem));

    expect(reset).toBeUndefined();
    expect(cache.inScopes(CHAIN)).toEqual([]);
  });

  test("is only replaced when the file itself is the problem", () => {
    const root = tempRoot();
    mkdirSync(dbFile(root));

    expect(() => openCache(dbFile(root))).toThrow();
    expect(existsSync(dbFile(root))).toBe(true);
  });
});

describe("close", () => {
  test("can be called twice", () => {
    const { cache } = setup();

    cache.close();

    expect(() => cache.close()).not.toThrow();
  });
});

import type { Database } from "bun:sqlite";
import type { MemoryId } from "../model/id";
import type { Kind } from "../model/kind";
import type { Memory } from "../model/memory";
import { ownField } from "../model/own-field";
import { type ScopeChain, scopeKey } from "../model/scope";
import { decodeMemory, encodeMemory } from "./codec";
import {
  CacheCorruptError,
  type DerivedSchema,
  isUnusableCache,
  openDerivedDatabase,
  wipeDatabaseFiles,
  writing,
} from "./derived-database";
import type { MemoryFiles } from "./memory-files";

// A memory_text row has the rowid of its memories row, so it is found without scanning. The
// explicit integer key keeps that rowid stable, which an implicit one is not across a VACUUM.
const SCHEMA: DerivedSchema = {
  version: 3,
  tables: ["memory_text", "memories"],
  sql: `
    CREATE TABLE IF NOT EXISTS memories (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      path TEXT NOT NULL UNIQUE,
      mtime REAL NOT NULL,
      updated TEXT NOT NULL,
      scope TEXT NOT NULL,
      kind TEXT NOT NULL,
      source TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_text USING fts5(
      title, body, tokenize = 'unicode61 remove_diacritics 2'
    );
  `,
};

const MAX_QUERY_WORDS = 32;

export interface SyncReport {
  // Files read and written to the cache during this sync, not the cache's total size.
  readonly indexed: number;
  // Cache rows dropped because their file is gone, unreadable or a duplicate.
  readonly removed: number;
  readonly invalid: ReadonlyArray<{ readonly path: string; readonly error: string }>;
}

// `reset` is why the cache file was thrown away and recreated, when it had to be.
interface OpenedCache {
  readonly cache: MemoryCache;
  readonly reset: string | undefined;
}

interface SyncedCache extends OpenedCache {
  readonly report: SyncReport;
}

interface CachedMemory {
  readonly memory: Memory;
  readonly path: string;
}

export interface RelatedQuery {
  readonly text: string;
  readonly scopes: ScopeChain;
  // Only these kinds; every kind when absent.
  readonly kinds?: readonly Kind[] | undefined;
  readonly limit: number;
}

// A derived, deletable index over the memory files; the files stay the source of truth.
export interface MemoryCache {
  // Brings the cache in line with the files: new or changed files are (re)indexed, rows of files
  // that are gone are dropped. Files that cannot be indexed are reported, never thrown.
  sync(files: MemoryFiles): SyncReport;
  // Replaces the row with this id and any row that holds this path.
  put(memory: Memory, path: string, mtimeMs: number): void;
  delete(id: MemoryId): void;
  get(id: MemoryId): CachedMemory | undefined;
  // Oldest first.
  inScopes(scopes: ScopeChain): Memory[];
  // Best match first, over title and body.
  related(query: RelatedQuery): Memory[];
  close(): void;
}

function select(db: Database, sql: string, params: ReadonlyArray<string | number>): unknown[] {
  return db.query<unknown, Array<string | number>>(sql).all(...params);
}

// Rows are read as unknown and narrowed here, the one place that trusts nothing from SQLite.
function textColumn(row: unknown, name: string): string {
  const value = ownField(row, name);
  if (typeof value !== "string") {
    throw new CacheCorruptError(`column ${name}`, "is not text");
  }
  return value;
}

function numberColumn(row: unknown, name: string): number {
  const value = ownField(row, name);
  if (typeof value !== "number") {
    throw new CacheCorruptError(`column ${name}`, "is not a number");
  }
  return value;
}

function cachedMemory(row: unknown): CachedMemory {
  const id = textColumn(row, "id");
  const decoded = decodeMemory(textColumn(row, "source"));
  if (!decoded.ok) {
    throw new CacheCorruptError(`memory ${id}`, `cannot be decoded: ${decoded.error}`);
  }
  return { memory: decoded.value, path: textColumn(row, "path") };
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function compareText(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function byCreation(a: Memory, b: Memory): number {
  return compareText(a.created, b.created) || compareText(a.id, b.id);
}

function removeById(db: Database, id: string): void {
  db.query("DELETE FROM memory_text WHERE rowid IN (SELECT seq FROM memories WHERE id = ?)").run(
    id,
  );
  db.query("DELETE FROM memories WHERE id = ?").run(id);
}

interface ListedFile {
  readonly path: string;
  readonly mtimeMs: number;
}

interface IndexEntry extends ListedFile {
  readonly memory: Memory;
}

function replaceEntry(db: Database, { memory, path, mtimeMs }: IndexEntry): void {
  db.query(
    "DELETE FROM memory_text WHERE rowid IN (SELECT seq FROM memories WHERE id = ? OR path = ?)",
  ).run(memory.id, path);
  db.query("DELETE FROM memories WHERE id = ? OR path = ?").run(memory.id, path);
  db.query(
    "INSERT INTO memories (id, path, mtime, updated, scope, kind, source) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    memory.id,
    path,
    mtimeMs,
    memory.updated,
    scopeKey(memory.scope),
    memory.kind,
    encodeMemory(memory),
  );
  db.query("INSERT INTO memory_text (rowid, title, body) VALUES (last_insert_rowid(), ?, ?)").run(
    memory.title,
    memory.body,
  );
}

interface IndexedRow {
  readonly id: string;
  readonly mtime: number;
  readonly updated: string;
}

interface ValidObservation extends ListedFile {
  readonly state: "valid";
  readonly id: string;
  readonly updated: string;
  // The memory read from the file; set only when its row was missing or out of date.
  readonly fresh?: Memory;
}

interface InvalidObservation {
  readonly state: "invalid";
  readonly path: string;
  readonly error: string;
}

type Observed = ValidObservation | InvalidObservation;

function indexedRows(db: Database): Map<string, IndexedRow> {
  const rows = select(db, "SELECT id, path, mtime, updated FROM memories", []);
  return new Map(
    rows.map((row): [string, IndexedRow] => [
      textColumn(row, "path"),
      {
        id: textColumn(row, "id"),
        mtime: numberColumn(row, "mtime"),
        updated: textColumn(row, "updated"),
      },
    ]),
  );
}

function observeFile(files: MemoryFiles, file: ListedFile, row: IndexedRow | undefined): Observed {
  // Any difference counts, not only a newer file: a restored backup carries an older time.
  if (row?.mtime === file.mtimeMs) {
    return { state: "valid", ...file, id: row.id, updated: row.updated };
  }
  const read = files.read(file.path);
  if (!read.ok) {
    return { state: "invalid", path: file.path, error: read.error };
  }
  const { id, updated } = read.value;
  return { state: "valid", ...file, id, updated, fresh: read.value };
}

// Sorted so the file that wins a duplicate id does not depend on directory order or cache state.
function observeAll(files: MemoryFiles, rows: ReadonlyMap<string, IndexedRow>): Observed[] {
  const observed: Observed[] = [];
  for (const path of files.listPaths().toSorted()) {
    const mtimeMs = files.mtimeMs(path);
    // A file removed since it was listed is handled like any other removed file.
    if (mtimeMs !== undefined) {
      observed.push(observeFile(files, { path, mtimeMs }, rows.get(path)));
    }
  }
  return observed;
}

// The most recently updated file wins, so a leftover copy never outranks the live one. Equal
// times go to the first path, which keeps the outcome independent of the cache's state.
function rejectDuplicateIds(observed: readonly Observed[]): Observed[] {
  const winners = new Map<string, ValidObservation>();
  for (const entry of observed) {
    if (entry.state !== "valid") {
      continue;
    }
    const best = winners.get(entry.id);
    if (best === undefined || compareText(entry.updated, best.updated) > 0) {
      winners.set(entry.id, entry);
    }
  }
  return observed.map(
    (entry): Observed =>
      entry.state === "valid" && winners.get(entry.id) !== entry
        ? { state: "invalid", path: entry.path, error: `duplicate id ${entry.id}` }
        : entry,
  );
}

function applySync(
  db: Database,
  rows: ReadonlyMap<string, IndexedRow>,
  observed: readonly Observed[],
): SyncReport {
  const kept = new Set<string>();
  const invalid: Array<{ path: string; error: string }> = [];
  const entries: IndexEntry[] = [];
  for (const item of observed) {
    if (item.state === "invalid") {
      invalid.push({ path: item.path, error: item.error });
      continue;
    }
    kept.add(item.path);
    if (item.fresh !== undefined) {
      entries.push({ memory: item.fresh, path: item.path, mtimeMs: item.mtimeMs });
    }
  }
  const staleIds = [...rows].filter(([path]) => !kept.has(path)).map(([, row]) => row.id);
  writing(db, () => {
    for (const id of staleIds) {
      removeById(db, id);
    }
    for (const entry of entries) {
      replaceEntry(db, entry);
    }
  });
  return { indexed: entries.length, removed: staleIds.length, invalid };
}

// Only whole words reach the MATCH expression, each quoted, so no text can act as FTS syntax.
// Combining marks belong to their word, or decomposed accents would split it.
function wordsIn(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
  return [...new Set(words)].slice(0, MAX_QUERY_WORDS);
}

function relatedMemories(db: Database, { text, scopes, kinds, limit }: RelatedQuery): Memory[] {
  const words = wordsIn(text);
  if (words.length === 0 || scopes.length === 0 || kinds?.length === 0) {
    return [];
  }
  const keys = scopes.map(scopeKey);
  const kindFilter = kinds === undefined ? "" : `AND m.kind IN (${placeholders(kinds.length)})`;
  const rows = select(
    db,
    `SELECT m.id, m.path, m.source
     FROM memory_text AS f JOIN memories AS m ON m.seq = f.rowid
     WHERE memory_text MATCH ? AND m.scope IN (${placeholders(keys.length)}) ${kindFilter}
     ORDER BY bm25(memory_text), m.id
     LIMIT ?`,
    [words.map((word) => `"${word}"`).join(" OR "), ...keys, ...(kinds ?? []), limit],
  );
  return rows.map((row) => cachedMemory(row).memory);
}

function cacheOver(db: Database): MemoryCache {
  return {
    sync(files) {
      const rows = indexedRows(db);
      return applySync(db, rows, rejectDuplicateIds(observeAll(files, rows)));
    },
    put(memory, path, mtimeMs) {
      writing(db, () => replaceEntry(db, { memory, path, mtimeMs }));
    },
    delete(id) {
      writing(db, () => removeById(db, id));
    },
    get(id) {
      const [row] = select(db, "SELECT id, path, source FROM memories WHERE id = ?", [id]);
      return row === undefined ? undefined : cachedMemory(row);
    },
    inScopes(scopes) {
      if (scopes.length === 0) {
        return [];
      }
      const keys = scopes.map(scopeKey);
      const rows = select(
        db,
        `SELECT id, path, source FROM memories WHERE scope IN (${placeholders(keys.length)})`,
        keys,
      );
      return rows.map((row) => cachedMemory(row).memory).toSorted(byCreation);
    },
    related: (query) => relatedMemories(db, query),
    close: () => db.close(),
  };
}

// The cache is derived from the memory files, so an unusable one is recreated from scratch.
export function openCache(file: string): OpenedCache {
  const { db, reset } = openDerivedDatabase(file, SCHEMA);
  return { cache: cacheOver(db), reset };
}

function syncOrClose(cache: MemoryCache, files: MemoryFiles): SyncReport {
  try {
    return cache.sync(files);
  } catch (error) {
    cache.close();
    throw error;
  }
}

// Opens the cache and brings it up to date. Damage that only shows while reading, not while
// opening, is handled the same way: recreate the cache and sync once more.
export function openSyncedCache(file: string, files: MemoryFiles): SyncedCache {
  const opened = openCache(file);
  try {
    return { ...opened, report: opened.cache.sync(files) };
  } catch (error) {
    opened.cache.close();
    if (!isUnusableCache(error)) {
      throw error;
    }
    wipeDatabaseFiles(file);
    const { cache } = openCache(file);
    return { cache, reset: error.message, report: syncOrClose(cache, files) };
  }
}

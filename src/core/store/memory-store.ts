import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { MemoryId } from "../model/id";
import type { Memory } from "../model/memory";
import type { ScopeChain } from "../model/scope";
import { type MemoryCache, openSyncedCache, type RelatedQuery, type SyncReport } from "./cache";
import { isUnusableCache } from "./derived-database";
import type { FileSystem } from "./fs";
import { memoryPath } from "./layout";
import { createMemoryFiles } from "./memory-files";

const CACHE_FILE = "cache.sqlite";

type CacheOperation = "save" | "forget";

export interface StoreFailureReporting {
  // Hears every cache update that failed after the files were already changed; the store has
  // then marked the cache for a resync.
  readonly onCacheFailure: (operation: CacheOperation, error: unknown) => void;
  // Hears a saved file whose directories could not be synced to disk; the save still succeeded.
  readonly onDirectorySyncFailure?: (path: string, error: unknown) => void;
}

export class MemoryFileMissingError extends Error {
  constructor(readonly path: string) {
    super(`memory file ${path} is missing right after it was written`);
    this.name = "MemoryFileMissingError";
  }
}

// What the features use: the files hold the truth, the cache only speeds up lookups.
export interface MemoryStore {
  // Writes the file, then the cache row. When the kind or scope changed, the old file is moved
  // to the new location first, so a save never deletes anything. Once the file is written the save
  // succeeded, even if the cache could not be updated; the cache then catches up on its next use.
  save(memory: Memory): void;
  // The only way a memory file is ever deleted; every file carrying the id goes.
  forget(memory: Memory): void;
  // Checks the memory's file first, so a hand edit or deletion is seen before anything is built
  // on the cached copy.
  get(id: MemoryId): Memory | undefined;
  // These two answer from the cache, as they run in hooks; `resync` is what picks up outside edits.
  inScopes(scopes: ScopeChain): Memory[];
  related(query: RelatedQuery): Memory[];
  // Brings the cache in line with the files, whatever changed them.
  resync(): SyncReport;
  // Changes after every save, forget and resync that found a difference, and when another plugin
  // instance sharing the cache changed it, so readers can tell when what they cached is stale.
  generation(): number;
  close(): void;
}

// A damaged cache must not stop a save, since the files are the truth. If the old location is
// then unknown, a leftover file with the same id loses the next sync's duplicate rule.
function cachedPath(cache: MemoryCache, id: MemoryId): string | undefined {
  try {
    return cache.get(id)?.path;
  } catch (error) {
    if (isUnusableCache(error)) {
      return undefined;
    }
    throw error;
  }
}

// `cacheReset` is why the cache file had to be
// recreated, for the caller to log; undefined when it opened normally.
export function openMemoryStore(
  root: string,
  fs: FileSystem,
  reporting: StoreFailureReporting,
): { store: MemoryStore; report: SyncReport; cacheReset: string | undefined } {
  // SQLite opens a real file, so the directory is created here rather than through `fs`.
  mkdirSync(root, { recursive: true });
  const files = createMemoryFiles(root, fs, reporting.onDirectorySyncFailure);
  const { cache, report, reset } = openSyncedCache(join(root, CACHE_FILE), files);
  let generation = 0;
  let seenForeignChanges = cache.foreignChanges();
  let cacheBehind = false;

  function resync(): SyncReport {
    const synced = cache.sync(files);
    cacheBehind = false;
    if (synced.indexed + synced.removed > 0) {
      generation += 1;
    }
    return synced;
  }

  // The files are already changed, so a failing cache is not a failed operation.
  function updateCache(operation: CacheOperation, update: () => void): void {
    generation += 1;
    try {
      update();
    } catch (error) {
      cacheBehind = true;
      reporting.onCacheFailure(operation, error);
    }
  }

  function catchUp(): void {
    if (cacheBehind) {
      resync();
    }
  }

  const store: MemoryStore = {
    save(memory) {
      const target = memoryPath(root, memory);
      const previous = cachedPath(cache, memory.id);
      // The cache may be stale, so only move a file that is really there.
      if (previous !== undefined && previous !== target && fs.mtimeMs(previous) !== undefined) {
        fs.move(previous, target);
      }
      files.write(memory);
      const mtimeMs = files.mtimeMs(target);
      if (mtimeMs === undefined) {
        throw new MemoryFileMissingError(target);
      }
      updateCache("save", () => cache.put(memory, target, mtimeMs));
    },
    // File first: a crash in between leaves a row that the next sync drops, not a file that
    // would come back.
    forget(memory) {
      files.removeAll(memory.id);
      updateCache("forget", () => cache.delete(memory.id));
    },
    // One stat per call, since a memory is looked up by id only when something is about to be
    // shown or changed. Any difference means the file changed behind the cache, and one resync
    // also finds a file that was moved or removed.
    get(id) {
      catchUp();
      const cached = cache.get(id);
      if (cached !== undefined && files.mtimeMs(cached.path) !== cached.mtimeMs) {
        resync();
        return cache.get(id)?.memory;
      }
      return cached?.memory;
    },
    inScopes(scopes) {
      catchUp();
      return cache.inScopes(scopes);
    },
    related(query) {
      catchUp();
      return cache.related(query);
    },
    resync,
    generation() {
      const foreign = cache.foreignChanges();
      if (foreign !== seenForeignChanges) {
        seenForeignChanges = foreign;
        generation += 1;
      }
      return generation;
    },
    close: () => cache.close(),
  };
  return { store, report, cacheReset: reset };
}

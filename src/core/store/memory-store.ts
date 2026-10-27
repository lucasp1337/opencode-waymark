import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { MemoryId } from "../model/id";
import type { Memory } from "../model/memory";
import type { ScopeChain } from "../model/scope";
import { isUnusableCache, type MemoryCache, openSyncedCache, type SyncReport } from "./cache";
import type { FileSystem } from "./fs";
import { memoryPath } from "./layout";
import { createMemoryFiles } from "./memory-files";

const CACHE_FILE = "cache.sqlite";

export class MemoryFileMissingError extends Error {
  constructor(readonly path: string) {
    super(`memory file ${path} is missing right after it was written`);
    this.name = "MemoryFileMissingError";
  }
}

// What the features use: the files hold the truth, the cache only speeds up lookups.
export interface MemoryStore {
  // Writes the file, then the cache row. When the kind or scope changed, the old file is moved
  // to the new location first, so a save never deletes anything.
  save(memory: Memory): void;
  // The only way a memory file is ever deleted.
  forget(memory: Memory): void;
  get(id: MemoryId): Memory | undefined;
  inScopes(scopes: ScopeChain): Memory[];
  related(text: string, scopes: ScopeChain, limit: number): Memory[];
  // Changes after every save and forget, so readers can tell when what they cached is stale.
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

// `cacheReset` is why the cache file had to be recreated, for the caller to log; undefined when it
// opened normally.
export function openMemoryStore(
  root: string,
  fs: FileSystem,
): { store: MemoryStore; report: SyncReport; cacheReset: string | undefined } {
  // SQLite opens a real file, so the directory is created here rather than through `fs`.
  mkdirSync(root, { recursive: true });
  const files = createMemoryFiles(root, fs);
  const { cache, report, reset } = openSyncedCache(join(root, CACHE_FILE), files);
  let generation = 0;

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
      cache.put(memory, target, mtimeMs);
      generation += 1;
    },
    // File first: a crash in between leaves a row that the next sync drops, not a file that
    // would come back.
    forget(memory) {
      files.remove(memory);
      cache.delete(memory.id);
      generation += 1;
    },
    get: (id) => cache.get(id)?.memory,
    inScopes: (scopes) => cache.inScopes(scopes),
    related: (text, scopes, limit) => cache.related(text, scopes, limit),
    generation: () => generation,
    close: () => cache.close(),
  };
  return { store, report, cacheReset: reset };
}

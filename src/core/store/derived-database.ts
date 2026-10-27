import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { ownField } from "../model/own-field";

// Other opencode processes may share the file; wait for their writes instead of failing.
const BUSY_TIMEOUT_MS = 2000;

export class CacheCorruptError extends Error {
  constructor(subject: string, reason: string) {
    super(`cache is corrupt: ${subject} ${reason}`);
    this.name = "CacheCorruptError";
  }
}

// A SQLite file that is derived from other data and can always be deleted and rebuilt.
export interface DerivedSchema {
  // Bump when the tables change; a different stored version drops `tables` and creates them anew.
  readonly version: number;
  // In the order they can be dropped.
  readonly tables: readonly string[];
  readonly sql: string;
}

export interface OpenedDatabase {
  readonly db: Database;
  // Why the file was thrown away and recreated, when it had to be.
  readonly reset: string | undefined;
}

// Immediate, so the write lock is taken up front and waits for other writers instead of failing
// when a read lock cannot be upgraded.
export function writing<T>(db: Database, work: () => T): T {
  return db.transaction(work).immediate();
}

// A version that cannot be read matches no schema, so the tables are built anew.
function storedVersion(db: Database): unknown {
  return ownField(db.query<unknown, []>("PRAGMA user_version").get(), "user_version");
}

function installSchema(db: Database, schema: DerivedSchema): void {
  writing(db, () => {
    if (storedVersion(db) !== schema.version) {
      db.exec(schema.tables.map((table) => `DROP TABLE IF EXISTS ${table};`).join("\n"));
    }
    db.exec(schema.sql);
    db.exec(`PRAGMA user_version = ${schema.version}`);
  });
}

function connect(file: string, schema: DerivedSchema): Database {
  const db = new Database(file, { create: true });
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.exec("PRAGMA journal_mode = WAL");
    installSchema(db, schema);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

// Only errors that say the file itself is unusable justify deleting it; a busy or read-only
// database belongs to someone else and must be left alone.
export function isUnusableCache(error: unknown): error is Error {
  if (error instanceof CacheCorruptError) {
    return true;
  }
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "SQLITE_NOTADB" || error.code === "SQLITE_CORRUPT")
  );
}

export function wipeDatabaseFiles(file: string): void {
  for (const path of [file, `${file}-wal`, `${file}-shm`]) {
    rmSync(path, { force: true });
  }
}

// The file is derived, so an unusable one is recreated from scratch.
export function openDerivedDatabase(file: string, schema: DerivedSchema): OpenedDatabase {
  try {
    return { db: connect(file, schema), reset: undefined };
  } catch (error) {
    if (!isUnusableCache(error)) {
      throw error;
    }
    wipeDatabaseFiles(file);
    return { db: connect(file, schema), reset: error.message };
  }
}

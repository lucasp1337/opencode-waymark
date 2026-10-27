import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDirs } from "../../../test/temp-dir";
import { ownField } from "../model/own-field";
import {
  CacheCorruptError,
  type DerivedSchema,
  isUnusableCache,
  openDerivedDatabase,
  writing,
} from "./derived-database";

const SCHEMA: DerivedSchema = {
  version: 1,
  tables: ["things"],
  sql: "CREATE TABLE IF NOT EXISTS things (name TEXT NOT NULL)",
};

const tempRoot = useTempDirs();
const opened: Database[] = [];

afterEach(() => {
  for (const db of opened.splice(0)) {
    db.close();
  }
});

function open(file: string, schema = SCHEMA) {
  const result = openDerivedDatabase(file, schema);
  opened.push(result.db);
  return result;
}

function dbFile(): string {
  return join(tempRoot(), "derived.sqlite");
}

// A pragma's answer sits in a column that is not always named like the pragma.
function pragma(db: Database, name: string, column = name): unknown {
  return ownField(db.query<unknown, []>(`PRAGMA ${name}`).get(), column);
}

function names(db: Database): unknown[] {
  return db
    .query<unknown, []>("SELECT name FROM things")
    .all()
    .map((row) => ownField(row, "name"));
}

describe("openDerivedDatabase", () => {
  test("creates the schema in a new file and records its version", () => {
    const { db, reset } = open(dbFile());

    expect(names(db)).toEqual([]);
    expect(pragma(db, "user_version")).toBe(1);
    expect(reset).toBeUndefined();
  });

  test("shares the file between processes through a write-ahead log", () => {
    const { db } = open(dbFile());

    expect(pragma(db, "journal_mode")).toBe("wal");
  });

  test("waits for other writers instead of failing at once", () => {
    const { db } = open(dbFile());

    expect(pragma(db, "busy_timeout", "timeout")).toBe(2000);
  });

  test("keeps the rows of a file that has the same schema version", () => {
    const file = dbFile();
    open(file).db.exec("INSERT INTO things VALUES ('kept')");

    expect(names(open(file).db)).toEqual(["kept"]);
  });

  test("drops the tables of a file with another schema version and builds them anew", () => {
    const file = dbFile();
    open(file).db.exec("INSERT INTO things VALUES ('old')");

    const { db, reset } = open(file, { ...SCHEMA, version: 2 });

    expect(names(db)).toEqual([]);
    expect(pragma(db, "user_version")).toBe(2);
    expect(reset).toBeUndefined();
  });

  test("replaces a file that is not a database and reports why", () => {
    const file = dbFile();
    writeFileSync(file, "garbage, not a database. ".repeat(20));

    const { db, reset } = open(file);

    expect(reset).toContain("file is not a database");
    expect(names(db)).toEqual([]);
  });

  test("leaves a file alone when the problem is not the file's content", () => {
    const file = dbFile();
    mkdirSync(file);

    expect(() => openDerivedDatabase(file, SCHEMA)).toThrow();
    expect(existsSync(file)).toBe(true);
  });
});

describe("writing", () => {
  test("keeps all of a transaction's changes or none", () => {
    const { db } = open(dbFile());

    expect(() =>
      writing(db, () => {
        db.exec("INSERT INTO things VALUES ('half')");
        throw new Error("interrupted");
      }),
    ).toThrow("interrupted");

    expect(names(db)).toEqual([]);
  });
});

describe("isUnusableCache", () => {
  test("is true for a corrupt cache", () => {
    expect(isUnusableCache(new CacheCorruptError("column x", "is not text"))).toBe(true);
  });

  test("is true for SQLite saying the file is not a database or is malformed", () => {
    expect(isUnusableCache(Object.assign(new Error("bad"), { code: "SQLITE_NOTADB" }))).toBe(true);
    expect(isUnusableCache(Object.assign(new Error("bad"), { code: "SQLITE_CORRUPT" }))).toBe(true);
  });

  test("is false for a busy database", () => {
    expect(isUnusableCache(Object.assign(new Error("busy"), { code: "SQLITE_BUSY" }))).toBe(false);
  });

  test("is false for anything that is not an error", () => {
    expect(isUnusableCache("corrupt")).toBe(false);
  });
});

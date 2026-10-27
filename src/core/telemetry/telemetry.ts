import type { Database } from "bun:sqlite";
import type { MemoryId } from "../model/id";
import { ownField } from "../model/own-field";
import { type DerivedSchema, openDerivedDatabase, writing } from "../store/derived-database";

export const DAY_MS = 24 * 60 * 60 * 1000;

// The counters cannot be rebuilt from the memory files. A lost or unusable file only starts them
// over, which delays an index exit and never deletes anything, so it is recreated like a cache.
const SCHEMA: DerivedSchema = {
  version: 1,
  tables: ["fire_times", "counters"],
  sql: `
    CREATE TABLE IF NOT EXISTS counters (
      id TEXT PRIMARY KEY,
      reads INTEGER NOT NULL DEFAULT 0,
      last_read INTEGER,
      sessions_since_read INTEGER NOT NULL DEFAULT 0,
      fires INTEGER NOT NULL DEFAULT 0,
      last_fired INTEGER
    );
    CREATE TABLE IF NOT EXISTS fire_times (
      id TEXT NOT NULL,
      fired_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS fire_times_by_id ON fire_times (id, fired_at);
  `,
};

export interface MemoryStats {
  readonly reads: number;
  readonly lastRead?: Date;
  // In-scope sessions that started since the last read; since creation when never read.
  readonly sessionsSinceRead: number;
  readonly fires: number;
  readonly lastFired?: Date;
}

export const UNSEEN: MemoryStats = { reads: 0, sessionsSinceRead: 0, fires: 0 };

export interface Telemetry {
  recordRead(id: MemoryId): void;
  // One more in-scope session has started for each of these memories.
  recordSessions(ids: readonly MemoryId[]): void;
  recordFire(id: MemoryId): void;
  // Fires within the last `days` days.
  firesWithin(id: MemoryId, days: number): number;
  // Memories nothing was recorded for count as unseen.
  stats(ids: readonly MemoryId[]): Map<MemoryId, MemoryStats>;
  close(): void;
}

// Rows are read as unknown and narrowed here; a column that is not a number counts as absent.
function count(row: unknown, column: string): number {
  const value = ownField(row, column);
  return typeof value === "number" ? value : 0;
}

function instant(row: unknown, column: string): Date | undefined {
  const value = ownField(row, column);
  return typeof value === "number" ? new Date(value) : undefined;
}

function statsOf(row: unknown): MemoryStats {
  if (row === null) {
    return UNSEEN;
  }
  const lastRead = instant(row, "last_read");
  const lastFired = instant(row, "last_fired");
  return {
    reads: count(row, "reads"),
    ...(lastRead === undefined ? {} : { lastRead }),
    sessionsSinceRead: count(row, "sessions_since_read"),
    fires: count(row, "fires"),
    ...(lastFired === undefined ? {} : { lastFired }),
  };
}

function recordRead(db: Database, id: MemoryId, at: number): void {
  db.query(
    `INSERT INTO counters (id, reads, last_read, sessions_since_read) VALUES (?, 1, ?, 0)
     ON CONFLICT (id) DO UPDATE SET
       reads = reads + 1, last_read = excluded.last_read, sessions_since_read = 0`,
  ).run(id, at);
}

function recordSessions(db: Database, ids: readonly MemoryId[]): void {
  if (ids.length === 0) {
    return;
  }
  const bump = db.query(
    `INSERT INTO counters (id, sessions_since_read) VALUES (?, 1)
     ON CONFLICT (id) DO UPDATE SET sessions_since_read = sessions_since_read + 1`,
  );
  writing(db, () => {
    for (const id of ids) {
      bump.run(id);
    }
  });
}

function recordFire(db: Database, id: MemoryId, at: number, retentionDays: number): void {
  writing(db, () => {
    db.query(
      `INSERT INTO counters (id, fires, last_fired) VALUES (?, 1, ?)
       ON CONFLICT (id) DO UPDATE SET fires = fires + 1, last_fired = excluded.last_fired`,
    ).run(id, at);
    db.query("INSERT INTO fire_times (id, fired_at) VALUES (?, ?)").run(id, at);
    db.query("DELETE FROM fire_times WHERE fired_at < ?").run(at - retentionDays * DAY_MS);
  });
}

function firesWithin(db: Database, id: MemoryId, since: number): number {
  const row = db
    .query<unknown, [string, number]>(
      "SELECT COUNT(*) AS fires FROM fire_times WHERE id = ? AND fired_at >= ?",
    )
    .get(id, since);
  return count(row, "fires");
}

function statsFor(db: Database, id: MemoryId): MemoryStats {
  return statsOf(db.query<unknown, [string]>("SELECT * FROM counters WHERE id = ?").get(id));
}

interface TelemetryOptions {
  // Fire times older than this are dropped when the next fire is recorded; the longest window
  // `firesWithin` is asked about.
  readonly fireRetentionDays: number;
}

// `reset` is why the file had to be recreated, for the caller to log; undefined when it opened
// normally.
export function openTelemetry(
  file: string,
  now: () => Date,
  { fireRetentionDays }: TelemetryOptions,
): { telemetry: Telemetry; reset: string | undefined } {
  const { db, reset } = openDerivedDatabase(file, SCHEMA);
  let closed = false;
  const telemetry: Telemetry = {
    recordRead: (id) => recordRead(db, id, now().getTime()),
    recordSessions: (ids) => recordSessions(db, ids),
    recordFire: (id) => recordFire(db, id, now().getTime(), fireRetentionDays),
    firesWithin: (id, days) => firesWithin(db, id, now().getTime() - days * DAY_MS),
    stats: (ids) => new Map(ids.map((id) => [id, statsFor(db, id)])),
    close() {
      if (!closed) {
        closed = true;
        db.close();
      }
    },
  };
  return { telemetry, reset };
}

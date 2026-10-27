import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { memoryId } from "../../../test/memory-id";
import { useTempDirs } from "../../../test/temp-dir";
import { DAY_MS, openTelemetry, type Telemetry, UNSEEN } from "./telemetry";

const START = new Date("2026-03-01T10:00:00.000Z").getTime();
const RETENTION_DAYS = 30;
const A = memoryId("01JB8Z6Q4R3M2N1P0V9W8X0001");
const B = memoryId("01JB8Z6Q4R3M2N1P0V9W8X0002");

const tempRoot = useTempDirs();
const opened: Telemetry[] = [];

afterEach(() => {
  for (const telemetry of opened.splice(0)) {
    telemetry.close();
  }
});

interface Setup {
  readonly telemetry: Telemetry;
  readonly file: string;
  readonly reset: string | undefined;
  readonly clock: { advance(ms: number): void };
}

// Each opening has its own fake clock, starting at START.
function open(
  file = join(tempRoot(), "telemetry.sqlite"),
  fireRetentionDays = RETENTION_DAYS,
): Setup {
  let current = START;
  const { telemetry, reset } = openTelemetry(file, () => new Date(current), { fireRetentionDays });
  opened.push(telemetry);
  const clock = {
    advance: (ms: number) => {
      current += ms;
    },
  };
  return { telemetry, file, reset, clock };
}

describe("telemetry stats", () => {
  test("answers zeros for a memory nothing was recorded for", () => {
    const { telemetry } = open();

    expect(telemetry.stats([A]).get(A)).toEqual(UNSEEN);
  });

  test("answers an entry for every id asked", () => {
    const { telemetry } = open();

    expect([...telemetry.stats([A, B]).keys()]).toEqual([A, B]);
  });
});

describe("telemetry reads", () => {
  test("counts a read and remembers when it happened", () => {
    const { telemetry } = open();

    telemetry.recordRead(A);

    expect(telemetry.stats([A]).get(A)).toEqual({
      reads: 1,
      lastRead: new Date(START),
      sessionsSinceRead: 0,
      fires: 0,
    });
  });

  test("keeps the time of the latest read", () => {
    const { telemetry, clock } = open();
    telemetry.recordRead(A);
    clock.advance(DAY_MS);

    telemetry.recordRead(A);

    expect(telemetry.stats([A]).get(A)).toMatchObject({
      reads: 2,
      lastRead: new Date(START + DAY_MS),
    });
  });

  test("resets the sessions since the last read", () => {
    const { telemetry } = open();
    telemetry.recordSessions([A]);
    telemetry.recordSessions([A]);

    telemetry.recordRead(A);

    expect(telemetry.stats([A]).get(A)?.sessionsSinceRead).toBe(0);
  });

  test("leaves other memories alone", () => {
    const { telemetry } = open();
    telemetry.recordSessions([B]);

    telemetry.recordRead(A);

    expect(telemetry.stats([B]).get(B)?.sessionsSinceRead).toBe(1);
  });
});

describe("telemetry sessions", () => {
  test("counts one more session for each memory given", () => {
    const { telemetry } = open();
    telemetry.recordSessions([A, B]);

    telemetry.recordSessions([A]);

    const stats = telemetry.stats([A, B]);
    expect(stats.get(A)?.sessionsSinceRead).toBe(2);
    expect(stats.get(B)?.sessionsSinceRead).toBe(1);
  });

  test("changes nothing for an empty list", () => {
    const { telemetry } = open();

    telemetry.recordSessions([]);

    expect(telemetry.stats([A]).get(A)).toEqual(UNSEEN);
  });

  test("does not wait for the write lock when there is nothing to record", () => {
    const { telemetry, file } = open();
    const other = new Database(file);
    other.exec("BEGIN IMMEDIATE");

    try {
      expect(() => telemetry.recordSessions([])).not.toThrow();
    } finally {
      other.close();
    }
  });

  test("does not count as a read", () => {
    const { telemetry } = open();

    telemetry.recordSessions([A]);

    expect(telemetry.stats([A]).get(A)).toEqual({ ...UNSEEN, sessionsSinceRead: 1 });
  });
});

describe("telemetry fires", () => {
  test("counts a fire and remembers when it happened", () => {
    const { telemetry } = open();

    telemetry.recordFire(A);

    expect(telemetry.stats([A]).get(A)).toEqual({
      reads: 0,
      sessionsSinceRead: 0,
      fires: 1,
      lastFired: new Date(START),
    });
  });

  test("counts the fires within the given days", () => {
    const { telemetry, clock } = open();
    telemetry.recordFire(A);
    clock.advance(10 * DAY_MS);
    telemetry.recordFire(A);
    telemetry.recordFire(B);

    expect(telemetry.firesWithin(A, 5)).toBe(1);
    expect(telemetry.firesWithin(A, 30)).toBe(2);
    expect(telemetry.firesWithin(B, 30)).toBe(1);
  });

  test("counts a fire exactly at the edge of the window and not one millisecond older", () => {
    const { telemetry, clock } = open();
    telemetry.recordFire(A);

    clock.advance(30 * DAY_MS);
    expect(telemetry.firesWithin(A, 30)).toBe(1);

    clock.advance(1);
    expect(telemetry.firesWithin(A, 30)).toBe(0);
  });

  test("counts none for a memory that never fired", () => {
    const { telemetry } = open();

    expect(telemetry.firesWithin(A, 30)).toBe(0);
  });

  test("forgets fire times older than the retention when the next fire is recorded", () => {
    const { telemetry, clock } = open();
    telemetry.recordFire(A);
    clock.advance(31 * DAY_MS);

    telemetry.recordFire(B);

    expect(telemetry.firesWithin(A, 60)).toBe(0);
  });

  test("keeps fire times as long as the retention it was opened with", () => {
    const { telemetry, clock } = open(join(tempRoot(), "telemetry.sqlite"), 7);
    telemetry.recordFire(A);
    clock.advance(6 * DAY_MS);
    telemetry.recordFire(B);
    expect(telemetry.firesWithin(A, 7)).toBe(1);

    clock.advance(2 * DAY_MS);
    telemetry.recordFire(B);

    expect(telemetry.firesWithin(A, 7)).toBe(0);
  });

  test("keeps the total count of fires after their times were forgotten", () => {
    const { telemetry, clock } = open();
    telemetry.recordFire(A);
    clock.advance(31 * DAY_MS);

    telemetry.recordFire(A);

    expect(telemetry.stats([A]).get(A)).toMatchObject({
      fires: 2,
      lastFired: new Date(START + 31 * DAY_MS),
    });
    expect(telemetry.firesWithin(A, 60)).toBe(1);
  });
});

describe("telemetry persistence", () => {
  test("keeps every counter when the file is opened again", () => {
    const first = open();
    first.telemetry.recordRead(A);
    first.telemetry.recordSessions([A, B]);
    first.telemetry.recordFire(B);
    first.telemetry.close();

    const { telemetry } = open(first.file);

    expect(telemetry.stats([A, B])).toEqual(
      new Map([
        [A, { reads: 1, lastRead: new Date(START), sessionsSinceRead: 1, fires: 0 }],
        [B, { reads: 0, sessionsSinceRead: 1, fires: 1, lastFired: new Date(START) }],
      ]),
    );
    expect(telemetry.firesWithin(B, 30)).toBe(1);
  });

  test("starts over with a file that is not a database and says why", () => {
    const file = join(tempRoot(), "telemetry.sqlite");
    writeFileSync(file, "this is not sqlite, and is long enough to be read as a header ".repeat(4));

    const { telemetry, reset } = open(file);

    expect(reset).toBeDefined();
    expect(telemetry.stats([A]).get(A)).toEqual(UNSEEN);
  });

  test("opens a fresh file without a reset", () => {
    expect(open().reset).toBeUndefined();
  });

  test("can be closed twice", () => {
    const { telemetry } = open();

    telemetry.close();

    expect(() => telemetry.close()).not.toThrow();
  });
});

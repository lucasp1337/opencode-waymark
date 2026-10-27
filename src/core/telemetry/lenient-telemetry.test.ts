import { describe, expect, test } from "bun:test";
import { memoryId } from "../../../test/memory-id";
import type { LogLevel } from "../port";
import { lenientTelemetry } from "./lenient-telemetry";
import type { Telemetry } from "./telemetry";

const A = memoryId("01JB8Z6Q4R3M2N1P0V9W8X0001");

function broken(): Telemetry {
  const fail = (): never => {
    throw new Error("database is locked");
  };
  return {
    recordRead: fail,
    recordSessions: fail,
    recordFire: fail,
    firesWithin: fail,
    stats: fail,
    close: fail,
  };
}

function lenientOverBroken() {
  const logged: Array<{ level: LogLevel; msg: string; data: unknown }> = [];
  const telemetry = lenientTelemetry(broken(), (level, msg, data) => {
    logged.push({ level, msg, data });
  });
  return { telemetry, logged };
}

describe("lenientTelemetry", () => {
  test("passes calls through when nothing fails", () => {
    const calls: string[] = [];
    const inner: Telemetry = {
      ...broken(),
      recordFire: (id) => {
        calls.push(id);
      },
      firesWithin: () => 7,
    };
    const telemetry = lenientTelemetry(inner, () => undefined);

    telemetry.recordFire(A);

    expect(calls).toEqual([A]);
    expect(telemetry.firesWithin(A, 30)).toBe(7);
  });

  test("answers a failed write as if it had been recorded and logs the failure", () => {
    const { telemetry, logged } = lenientOverBroken();

    telemetry.recordRead(A);
    telemetry.recordSessions([A]);
    telemetry.recordFire(A);

    expect(logged.map((entry) => entry.data)).toEqual([
      { operation: "recordRead", error: "Error: database is locked" },
      { operation: "recordSessions", error: "Error: database is locked" },
      { operation: "recordFire", error: "Error: database is locked" },
    ]);
    expect(logged.every((entry) => entry.level === "warn")).toBe(true);
  });

  test("answers a failed count with zero fires", () => {
    const { telemetry } = lenientOverBroken();

    expect(telemetry.firesWithin(A, 30)).toBe(0);
  });

  test("answers failed stats with no stats", () => {
    const { telemetry } = lenientOverBroken();

    expect(telemetry.stats([A]).size).toBe(0);
  });

  test("closes the telemetry it wraps", () => {
    let closed = 0;
    const telemetry = lenientTelemetry(
      {
        ...broken(),
        close: () => {
          closed += 1;
        },
      },
      () => undefined,
    );

    telemetry.close();

    expect(closed).toBe(1);
  });
});

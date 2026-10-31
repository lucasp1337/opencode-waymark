import { describe, expect, test } from "bun:test";
import type { LogLevel } from "../core/port";
import type { Logger } from "../logger";
import { attempt, collect, each } from "./isolation";

interface Entry {
  level: LogLevel;
  msg: string;
  data: unknown;
}

function recordingLogger(): { logger: Logger; entries: Entry[] } {
  const entries: Entry[] = [];
  return { logger: { log: (level, msg, data) => entries.push({ level, msg, data }) }, entries };
}

const boom = (): Promise<string | null> => Promise.reject(new Error("boom"));

describe("attempt", () => {
  test("returns the value of a successful run", async () => {
    const { logger } = recordingLogger();

    expect(await attempt(logger, "h", () => 7)).toEqual({ ok: true, value: 7 });
  });

  test("logs the hook and error then reports failure when the run throws", async () => {
    const { logger, entries } = recordingLogger();

    expect(await attempt(logger, "h", boom)).toEqual({ ok: false });
    expect(entries).toEqual([
      { level: "error", msg: "hook failed", data: { hook: "h", error: "Error: boom" } },
    ]);
  });
});

describe("collect", () => {
  test("keeps the texts of every handler that produced one, in order", async () => {
    const { logger } = recordingLogger();
    const fns = [
      (n: number) => Promise.resolve(`a${n}`),
      () => Promise.resolve(null),
      (n: number) => Promise.resolve(`c${n}`),
    ];

    expect(await collect(logger, "h", fns, 1)).toEqual(["a1", "c1"]);
  });

  test("a throwing handler is logged and the others still contribute", async () => {
    const { logger, entries } = recordingLogger();
    const fns = [() => Promise.resolve("first"), boom, () => Promise.resolve("last")];

    expect(await collect(logger, "h", fns)).toEqual(["first", "last"]);
    expect(entries).toHaveLength(1);
  });
});

describe("each", () => {
  test("a throwing handler is logged and the later handlers still run", async () => {
    const { logger, entries } = recordingLogger();
    const seen: string[] = [];
    const fns = [
      (id: string) => {
        seen.push(`a:${id}`);
      },
      () => {
        throw new Error("boom");
      },
      (id: string) => {
        seen.push(`c:${id}`);
      },
    ];

    await each(logger, "h", fns, "s1");

    expect(seen).toEqual(["a:s1", "c:s1"]);
    expect(entries).toHaveLength(1);
  });
});

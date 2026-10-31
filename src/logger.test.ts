import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileLogger, logFilePath } from "./logger";

const NOW = new Date("2026-01-02T03:04:05.000Z");

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "waymark-logger-"));
}

describe("logFilePath", () => {
  test("uses XDG_STATE_HOME when set", () => {
    expect(logFilePath({ XDG_STATE_HOME: "/state" })).toBe("/state/waymark/waymark.log");
  });

  test("falls back to ~/.local/state", () => {
    expect(logFilePath({})).toEndWith("/.local/state/waymark/waymark.log");
  });

  test("falls back when XDG_STATE_HOME is empty", () => {
    expect(logFilePath({ XDG_STATE_HOME: "" })).toEndWith("/.local/state/waymark/waymark.log");
  });

  test("falls back when XDG_STATE_HOME is relative", () => {
    expect(logFilePath({ XDG_STATE_HOME: "state" })).toEndWith("/.local/state/waymark/waymark.log");
  });
});

describe("createFileLogger", () => {
  test("appends one JSON line per entry with the injected timestamp", () => {
    const dir = tempDir();
    const file = join(dir, "nested", "waymark.log");
    const logger = createFileLogger(file, () => NOW);

    logger.log("info", "first", { a: 1 });
    logger.log("error", "second");

    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { t: NOW.toISOString(), level: "info", msg: "first", data: { a: 1 } },
      { t: NOW.toISOString(), level: "error", msg: "second" },
    ]);
    rmSync(dir, { recursive: true });
  });

  test("does not throw when the data cannot be serialized, and keeps logging", () => {
    const dir = tempDir();
    const file = join(dir, "waymark.log");
    const logger = createFileLogger(file, () => NOW);
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => logger.log("warn", "circular", circular)).not.toThrow();
    expect(() => logger.log("warn", "big", 10n)).not.toThrow();
    logger.log("info", "after");

    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
    rmSync(dir, { recursive: true });
  });

  test("does not throw when the log directory cannot be created", () => {
    const dir = tempDir();
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "");
    const logger = createFileLogger(join(blocker, "nested", "waymark.log"), () => NOW);

    expect(() => logger.log("warn", "lost")).not.toThrow();
    rmSync(dir, { recursive: true });
  });
});

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

  test("does not throw when the file cannot be written", () => {
    const dir = tempDir();
    const logger = createFileLogger(join(dir, "waymark.log"), () => NOW);
    rmSync(dir, { recursive: true });

    expect(() => logger.log("warn", "lost")).not.toThrow();
  });
});

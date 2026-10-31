import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { LogLevel } from "./core/port";
import { absoluteOr } from "./core/xdg";

export interface Logger {
  log(level: LogLevel, msg: string, data?: unknown): void;
}

export function logFilePath(env: Record<string, string | undefined>): string {
  const state = absoluteOr(env.XDG_STATE_HOME, join(homedir(), ".local", "state"));
  return join(state, "waymark", "waymark.log");
}

// Sync append on purpose: hooks must never lose a line to a crash, and the TUI owns stdout.
export function createFileLogger(file: string, now: () => Date): Logger {
  return {
    log(level, msg, data) {
      try {
        const line = JSON.stringify({ t: now().toISOString(), level, msg, data });
        mkdirSync(dirname(file), { recursive: true });
        appendFileSync(file, `${line}\n`);
      } catch {
        // A failing log must not fail the user's operation; nowhere else to report it.
      }
    },
  };
}

import type { Memory } from "../model/memory";
import { scopeKey } from "../model/scope";

const UPDATED_DAY_LENGTH = "YYYY-MM-DD".length;

// How memories are named to the agent: the one-line listing form, the dated title, and the
// applies line.
export function memoryLine(memory: Memory): string {
  const line = `[${memory.id}] ${memory.kind} · ${scopeKey(memory.scope)} · ${datedTitle(memory)}`;
  return memory.locator === undefined ? line : `${line} → ${memory.locator}`;
}

// The lines that say when a memory applies; none when it does not say.
export function appliesLines(memory: Memory): string[] {
  return memory.howToApply === undefined ? [] : [`Applies: ${memory.howToApply}`];
}

// The day of the last write, so the agent can judge how stale a memory may be.
export function datedTitle(memory: Memory): string {
  return `${memory.title} (${memory.updated.slice(0, UPDATED_DAY_LENGTH)})`;
}

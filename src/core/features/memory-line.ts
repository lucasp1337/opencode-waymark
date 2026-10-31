import type { Memory } from "../model/memory";
import { scopeKey } from "../model/scope";

// The one-line form every tool uses to list memories.
export function memoryLine(memory: Memory): string {
  const line = `[${memory.id}] ${memory.kind} · ${scopeKey(memory.scope)} · ${memory.title}`;
  return memory.locator === undefined ? line : `${line} → ${memory.locator}`;
}

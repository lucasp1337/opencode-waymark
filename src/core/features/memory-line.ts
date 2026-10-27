import type { Memory } from "../model/memory";
import { scopeKey } from "../model/scope";

// The one-line form every tool uses to list memories.
export function memoryLine(memory: Memory): string {
  return `[${memory.id}] ${memory.kind} · ${scopeKey(memory.scope)} · ${memory.title}`;
}

import type { MemoryId } from "../../model/id";
import { isAlwaysOn, isIndexed } from "../../model/kind";
import type { Memory } from "../../model/memory";
import { alwaysOnText } from "./always-on";
import { indexLine } from "./session-block";

// The `updated` stamp of every memory the session block was rendered from, shown or not. A
// memory with the same stamp is not new to the session; a missing or different one is.
export type Baseline = ReadonlyMap<MemoryId, string>;

function reachesSessionBlock(memory: Memory): boolean {
  return isAlwaysOn(memory.kind) || isIndexed(memory.kind);
}

export function baselineOf(memories: readonly Memory[]): Baseline {
  return new Map(memories.filter(reachesSessionBlock).map((memory) => [memory.id, memory.updated]));
}

// Memories that reached the session after its block was frozen, in the order they wait for an
// output that can carry text.
export interface FreshQueue {
  // The stamp last queued per memory, so each version is delivered once.
  readonly queuedStamps: Map<MemoryId, string>;
  readonly waiting: Map<MemoryId, Memory>;
}

export function createFreshQueue(): FreshQueue {
  return { queuedStamps: new Map(), waiting: new Map() };
}

export function queueFresh(
  queue: FreshQueue,
  memories: readonly Memory[],
  baseline: Baseline,
  isOwn: (memory: Memory) => boolean,
): void {
  for (const memory of memories) {
    if (
      reachesSessionBlock(memory) &&
      !isOwn(memory) &&
      baseline.get(memory.id) !== memory.updated &&
      queue.queuedStamps.get(memory.id) !== memory.updated
    ) {
      queue.queuedStamps.set(memory.id, memory.updated);
      queue.waiting.set(memory.id, memory);
    }
  }
}

function freshText(memory: Memory): string {
  return isAlwaysOn(memory.kind)
    ? `waymark · new ${memory.kind} · ${memory.title}\n${alwaysOnText(memory)}`
    : `waymark · new ${memory.kind} (memory_read for the full text)\n${indexLine(memory)}`;
}

export function takeFresh(queue: FreshQueue): string[] {
  const texts = [...queue.waiting.values()].map(freshText);
  queue.waiting.clear();
  return texts;
}

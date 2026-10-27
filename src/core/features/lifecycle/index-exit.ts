import type { MemoryId } from "../../model/id";
import { isIndexed } from "../../model/kind";
import type { Memory } from "../../model/memory";
import { DAY_MS, type MemoryStats, UNSEEN } from "../../telemetry/telemetry";
import type { IndexExitThresholds } from "./lifecycle-settings";

// What the index needs to know about reading habits.
export interface IndexUsage {
  readonly stats: ReadonlyMap<MemoryId, MemoryStats>;
  readonly now: Date;
  readonly exit: IndexExitThresholds;
}

function statsOf(memory: Memory, usage: IndexUsage): MemoryStats {
  return usage.stats.get(memory.id) ?? UNSEEN;
}

// A memory never read counts its age from creation.
function hasLeftIndex(memory: Memory, usage: IndexUsage): boolean {
  const stats = statsOf(memory, usage);
  const since = stats.lastRead?.getTime() ?? Date.parse(memory.created);
  return (
    stats.sessionsSinceRead >= usage.exit.sessions &&
    usage.now.getTime() - since >= usage.exit.days * DAY_MS
  );
}

// Epoch for never read, so those sort after every real read.
function lastReadAt(memory: Memory, usage: IndexUsage): number {
  return statsOf(memory, usage).lastRead?.getTime() ?? 0;
}

// The facts and decisions the index may show: those still in use, most recently read first and,
// among equals, most recently updated first. The rest stay readable and searchable.
export function visibleIndex(memories: readonly Memory[], usage: IndexUsage): Memory[] {
  return memories
    .filter((memory) => isIndexed(memory.kind) && !hasLeftIndex(memory, usage))
    .toSorted(
      (a, b) => lastReadAt(b, usage) - lastReadAt(a, usage) || b.updated.localeCompare(a.updated),
    );
}

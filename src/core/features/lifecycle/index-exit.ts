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
export function hasLeftIndex(memory: Memory, usage: IndexUsage): boolean {
  const stats = statsOf(memory, usage);
  const since = stats.lastRead?.getTime() ?? Date.parse(memory.created);
  return (
    stats.sessionsSinceRead >= usage.exit.sessions &&
    usage.now.getTime() - since >= usage.exit.days * DAY_MS
  );
}

// A new or just edited memory competes with the ones read lately; otherwise a full index would
// admit nothing until something was read.
function activityAt(memory: Memory, usage: IndexUsage): number {
  return Math.max(statsOf(memory, usage).lastRead?.getTime() ?? 0, Date.parse(memory.updated));
}

// The facts and decisions the index may show: those still in use, most recently read or updated
// first. The rest stay readable and searchable.
export function visibleIndex(memories: readonly Memory[], usage: IndexUsage): Memory[] {
  return memories
    .filter((memory) => isIndexed(memory.kind) && !hasLeftIndex(memory, usage))
    .toSorted((a, b) => activityAt(b, usage) - activityAt(a, usage));
}

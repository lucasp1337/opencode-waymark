import { isAlwaysOn } from "../../model/kind";
import type { Memory, MemoryContent } from "../../model/memory";
import { err, ok, type Result } from "../../model/result";
import { type ScopeLevel, scopeKey } from "../../model/scope";
import { alwaysOnText } from "../recall/always-on";

export type BudgetCaps = { readonly [L in ScopeLevel]: number };

const CHARS_PER_TOKEN = 4;

// Measured on the text the session block shows, so the cap bounds what the agent reads.
export function tokensOf(content: MemoryContent): number {
  return Math.ceil(alwaysOnText(content).length / CHARS_PER_TOKEN);
}

export interface BudgetRefusal {
  readonly cap: number;
  readonly used: number;
  readonly needed: number;
  readonly current: readonly Memory[];
}

// `active` are the memories still delivered in the memory's scope. The memory's own earlier
// version and the one it supersedes leave the budget when it is saved.
export function checkBudget(
  memory: Memory,
  active: readonly Memory[],
  caps: BudgetCaps,
): Result<void, BudgetRefusal> {
  if (!isAlwaysOn(memory.kind)) {
    return ok(undefined);
  }
  const key = scopeKey(memory.scope);
  const current = active.filter(
    (other) =>
      isAlwaysOn(other.kind) &&
      scopeKey(other.scope) === key &&
      other.id !== memory.id &&
      other.id !== memory.supersedes,
  );
  const used = current.reduce((sum, other) => sum + tokensOf(other), 0);
  const needed = tokensOf(memory);
  const cap = caps[memory.scope.level];
  return used + needed > cap ? err({ cap, used, needed, current }) : ok(undefined);
}

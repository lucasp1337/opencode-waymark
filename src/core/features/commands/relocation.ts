import { isAlwaysOn } from "../../model/kind";
import { activeOnly, type Memory } from "../../model/memory";
import { err, ok, type Result } from "../../model/result";
import type { ScopeRef } from "../../model/scope";
import { type BudgetRefusal, checkBudget, tokensOf } from "../save/budget";
import type { ToolDeps } from "../tool-deps";

export type RelocationDeps = Pick<ToolDeps, "host" | "store" | "now" | "caps">;

// The numbers describe the whole group: what the target holds now against everything arriving.
export interface ArrivalRefusal extends BudgetRefusal {
  // The memories that would arrive and take room, still shown in the scope they are in now.
  readonly arriving: readonly Memory[];
}

export function relocated(memory: Memory, scope: ScopeRef, now: Date): Memory {
  return { ...memory, scope, updated: now.toISOString() };
}

function totalTokens(memories: readonly Memory[]): number {
  return memories.reduce((sum, memory) => sum + tokensOf(memory), 0);
}

// Checks the memories one after another, so together they must fit the scope's cap, not just
// each alone. Memories that are replaced are not delivered, so they take no room.
export function checkArrivals(
  deps: Pick<RelocationDeps, "store" | "caps">,
  target: ScopeRef,
  arriving: readonly Memory[],
): Result<void, ArrivalRefusal> {
  const present = deps.store.inScopes([target]);
  const delivered = new Set(activeOnly([...present, ...arriving]).map((memory) => memory.id));
  const counted = arriving.filter((memory) => delivered.has(memory.id) && isAlwaysOn(memory.kind));
  const accepted = [...present];
  for (const memory of counted) {
    const arrived = { ...memory, scope: target };
    const verdict = checkBudget(arrived, activeOnly(accepted), deps.caps());
    if (!verdict.ok) {
      const ids = new Set(counted.map((other) => other.id));
      const current = verdict.error.current.filter((other) => !ids.has(other.id));
      return err({
        cap: verdict.error.cap,
        used: totalTokens(current),
        needed: totalTokens(counted),
        current,
        arriving: counted,
      });
    }
    accepted.push(arrived);
  }
  return ok(undefined);
}

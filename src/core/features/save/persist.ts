import { isAlwaysOn, KINDS } from "../../model/kind";
import type { Memory } from "../../model/memory";
import { activeOnly } from "../../model/memory";
import { scopeKey } from "../../model/scope";
import { notify } from "../../notify";
import { memoryLine } from "../memory-line";
import type { ToolDeps } from "../tool-deps";
import { type BudgetRefusal, checkBudget, tokensOf } from "./budget";

const ALWAYS_ON_KINDS = KINDS.filter(isAlwaysOn).join(" and ");

function budgetMessage(memory: Memory, refusal: BudgetRefusal, refused: string): string {
  return [
    `${refused}: ${ALWAYS_ON_KINDS} memories in ${scopeKey(memory.scope)} are capped at ${refusal.cap} tokens; ${refusal.used} are used and this one needs ${refusal.needed}.`,
    "Offer the user to merge memories or demote one to a fact. Current:",
    ...refusal.current.map((other) => `- ${memoryLine(other)} (${tokensOf(other)} tokens)`),
  ].join("\n");
}

// The shared tail of every save: budget, atomic write, toast.
export async function persistMemory(
  deps: ToolDeps,
  memory: Memory,
  verb: "saved" | "updated",
): Promise<string> {
  const budget = checkBudget(memory, activeOnly(deps.store.inScopes([memory.scope])), deps.caps);
  if (!budget.ok) {
    return budgetMessage(memory, budget.error, verb === "saved" ? "Not saved" : "Not updated");
  }
  deps.store.save(memory);
  await notify(deps.host, `waymark · ${verb} ${memory.kind} · ${scopeKey(memory.scope)}`);
  return `${verb === "saved" ? "Saved" : "Updated"} ${memoryLine(memory)}`;
}

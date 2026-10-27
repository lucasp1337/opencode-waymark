import type { Memory } from "../../model/memory";
import { activeOnly } from "../../model/memory";
import { scopeKey } from "../../model/scope";
import { notify } from "../../notify";
import { memoryLine } from "../memory-line";
import type { ToolDeps } from "../tool-deps";
import { checkBudget } from "./budget";
import { budgetRefusalText } from "./budget-refusal";

const WORDING = {
  saved: { done: "Saved", refused: "Not saved" },
  updated: { done: "Updated", refused: "Not updated" },
} as const;

// The shared tail of every save: budget, atomic write, toast.
export async function persistMemory(
  deps: Pick<ToolDeps, "host" | "store" | "caps">,
  memory: Memory,
  verb: keyof typeof WORDING,
): Promise<string> {
  const budget = checkBudget(memory, activeOnly(deps.store.inScopes([memory.scope])), deps.caps());
  if (!budget.ok) {
    return budgetRefusalText(WORDING[verb].refused, memory.scope, budget.error);
  }
  deps.store.save(memory);
  await notify(deps.host, `waymark · ${verb} ${memory.kind} · ${scopeKey(memory.scope)}`);
  return `${WORDING[verb].done} ${memoryLine(memory)}`;
}

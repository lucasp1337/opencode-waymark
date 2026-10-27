import { isAlwaysOn, KINDS } from "../../model/kind";
import { type ScopeRef, scopeKey } from "../../model/scope";
import { memoryLine } from "../memory-line";
import { type BudgetRefusal, tokensOf } from "./budget";

const ALWAYS_ON_KINDS = KINDS.filter(isAlwaysOn).join(" and ");

// The one wording for a memory that does not fit its scope's cap, whether it is new, changed or
// moved. `refused` is the start of the sentence, such as "Not saved".
export function budgetRefusalText(
  refused: string,
  scope: ScopeRef,
  refusal: BudgetRefusal,
): string {
  return [
    `${refused}: ${ALWAYS_ON_KINDS} memories in ${scopeKey(scope)} are capped at ${refusal.cap} tokens; ${refusal.used} are used and the memory needs ${refusal.needed}.`,
    `Offer the user one of: merge these memories, demote one to a fact, or raise the cap with memory_config (caps: { ${scope.level}: <tokens> }). Current:`,
    ...refusal.current.map((other) => `- ${memoryLine(other)} (${tokensOf(other)} tokens)`),
  ].join("\n");
}

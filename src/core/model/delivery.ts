import { isAlwaysOn, isIndexed, isRecalledByTrigger } from "./kind";
import type { Memory } from "./memory";

// Only at product scope, where the targets mean something; a hand-edited memory elsewhere with
// repos is an ordinary memory of its kind.
export function targetedRepos(memory: Memory): readonly string[] {
  return memory.scope.level === "product" ? (memory.triggers?.repos ?? []) : [];
}

function isRepoTargeted(memory: Memory): boolean {
  return targetedRepos(memory).length > 0;
}

// The memories of one product's own scope.
export function inProduct(memories: readonly Memory[], product: string): Memory[] {
  return memories.filter(
    (memory) => memory.scope.level === "product" && memory.scope.id === product,
  );
}

// How a product's repos are reported when the registry cannot give them.
export function productReposUnreadable(product: string, reason: string): string {
  return `the repos of product ${product} could not be read (${reason})`;
}

// A memory aimed at repos is shown by where it applies, not by its kind: listed in the index and
// delivered when one of those repos is touched. Every "how does this reach the agent" question
// goes through these three.
export function isShownAlways(memory: Memory): boolean {
  return !isRepoTargeted(memory) && isAlwaysOn(memory.kind);
}

export function isListedInIndex(memory: Memory): boolean {
  return isRepoTargeted(memory) || isIndexed(memory.kind);
}

export function isDeliveredOnTrigger(memory: Memory): boolean {
  return isRepoTargeted(memory) || isRecalledByTrigger(memory.kind);
}

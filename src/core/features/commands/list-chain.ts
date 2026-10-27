import { KINDS } from "../../model/kind";
import type { Memory } from "../../model/memory";
import { type ScopeChain, type ScopeRef, scopeKey } from "../../model/scope";
import { memoryLine } from "../memory-line";

function scopeSection(scope: ScopeRef, memories: readonly Memory[]): string {
  const own = memories.filter((memory) => scopeKey(memory.scope) === scopeKey(scope));
  const kinds = KINDS.flatMap((kind) => {
    const ofKind = own.filter((memory) => memory.kind === kind);
    return ofKind.length === 0
      ? []
      : [`${kind} (${ofKind.length})`, ...ofKind.map((memory) => `- ${memoryLine(memory)}`)];
  });
  return [`## ${scopeKey(scope)} (${own.length})`, ...kinds].join("\n");
}

// The memories are the active ones of the chain, so a replaced memory is not listed.
export function listChain(chain: ScopeChain, memories: readonly Memory[]): string {
  return chain.map((scope) => scopeSection(scope, memories)).join("\n\n");
}

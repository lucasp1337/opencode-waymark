import type { MemoryId } from "../../model/id";
import type { Memory } from "../../model/memory";
import { err, ok, type Result } from "../../model/result";
import {
  type ScopeChain,
  type ScopeLevel,
  type ScopeRef,
  scopeAt,
  scopeKey,
} from "../../model/scope";
import { memoryLine } from "../memory-line";
import { persistMemory } from "../save/persist";
import { type RelocationDeps, relocated } from "./relocation";

const USER_SCOPE: ScopeRef = { level: "user" };

// The scopes every session that delivers `scope` is certain to deliver too. A repo has one org
// and at most one product, known from the session's chain when it is that repo's. An org spans
// repos with and without a product, and a product spans repos of several orgs, so neither
// brings along anything narrower or beside it.
function alwaysAlongside(chain: ScopeChain, scope: ScopeRef): ScopeChain {
  const isSessionRepo = scope.level === "repo" && chain.some((other) => sameScope(other, scope));
  return isSessionRepo ? chain : [USER_SCOPE, scope];
}

function sameScope(a: ScopeRef, b: ScopeRef): boolean {
  return scopeKey(a) === scopeKey(b);
}

// Sessions that deliver the replaced memory must also deliver its replacement, or the old one
// comes back.
function stillHidesReplaced(chain: ScopeChain, target: ScopeRef, replaced: Memory): boolean {
  return alwaysAlongside(chain, replaced.scope).some((scope) => sameScope(scope, target));
}

// A replaced memory is hidden only while its replacement is delivered next to it, which a move
// can break in either direction.
function checkReplacement(
  deps: Pick<RelocationDeps, "store">,
  memory: Memory,
  target: ScopeRef,
  chain: ScopeChain,
): Result<void, string> {
  const replacement = deps.store
    .inScopes([...chain, memory.scope])
    .find((other) => other.supersedes === memory.id);
  if (replacement !== undefined) {
    return err(
      `[${memory.id}] was replaced by [${replacement.id}]; forget it or move the replacement.`,
    );
  }
  const replaced = memory.supersedes === undefined ? undefined : deps.store.get(memory.supersedes);
  if (replaced !== undefined && !stillHidesReplaced(chain, target, replaced)) {
    return err(
      `[${memory.id}] replaces [${replaced.id}] in ${scopeKey(replaced.scope)}, which would show again in sessions that do not see ${scopeKey(target)}. Forget [${replaced.id}] first, or move [${memory.id}] to a broader scope.`,
    );
  }
  return ok(undefined);
}

export async function moveMemory(
  deps: RelocationDeps,
  request: { readonly id: MemoryId; readonly level: ScopeLevel },
  chain: ScopeChain,
): Promise<string> {
  const memory = deps.store.get(request.id);
  if (memory === undefined) {
    return `Not moved: no memory with id ${request.id}`;
  }
  const target = scopeAt(chain, request.level);
  if (target === undefined) {
    return `Not moved: this session has no ${request.level} scope; it has ${chain.map(scopeKey).join(", ")}.`;
  }
  if (sameScope(target, memory.scope)) {
    return `Not moved: ${memoryLine(memory)} is already in ${scopeKey(target)}.`;
  }
  const replacement = checkReplacement(deps, memory, target, chain);
  if (!replacement.ok) {
    return `Not moved: ${replacement.error}`;
  }
  return await persistMemory(deps, relocated(memory, target, deps.now()), "moved");
}

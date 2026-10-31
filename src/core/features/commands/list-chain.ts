import { KINDS } from "../../model/kind";
import { activeOnly, type Memory } from "../../model/memory";
import { type ScopeChain, type ScopeRef, scopeKey } from "../../model/scope";
import { productRepos } from "../../scope/products";
import { catchRegistryIo } from "../../scope/registry-file";
import type { FileSystem } from "../../store/fs";
import type { MemoryStore } from "../../store/memory-store";
import { memoryLine } from "../memory-line";

// Most memories listed per scope; the rest are found with memory_search.
const LINES_PER_SCOPE = 40;

function scopeSection(scope: ScopeRef, memories: readonly Memory[]): string {
  const own = memories.filter((memory) => scopeKey(memory.scope) === scopeKey(scope));
  const ordered = KINDS.flatMap((kind) => own.filter((memory) => memory.kind === kind));
  const shown = ordered.slice(0, LINES_PER_SCOPE);
  const kinds = KINDS.flatMap((kind) => {
    const ofKind = shown.filter((memory) => memory.kind === kind);
    const total = own.filter((memory) => memory.kind === kind).length;
    return ofKind.length === 0
      ? []
      : [`${kind} (${total})`, ...ofKind.map((memory) => `- ${memoryLine(memory)}`)];
  });
  const hidden = ordered.length - shown.length;
  const more = hidden === 0 ? [] : [`+${hidden} more — use memory_search`];
  return [`## ${scopeKey(scope)} (${own.length})`, ...kinds, ...more].join("\n");
}

interface ListDeps {
  readonly store: Pick<MemoryStore, "inScopes">;
  readonly fs: FileSystem;
  readonly registryFile: string;
}

function productLine(deps: ListDeps, chain: ScopeChain): string[] {
  const product = chain.find((scope) => scope.level === "product");
  if (product === undefined) {
    return [];
  }
  const repos = catchRegistryIo(() => productRepos(deps.fs, deps.registryFile, product.id));
  return [
    repos.ok
      ? `Product ${product.id}: ${repos.value.join(", ")}`
      : `Product ${product.id}: its repos could not be read (${repos.error})`,
  ];
}

// The memories listed are the active ones of the chain, so a replaced memory is not listed.
export function listChain(deps: ListDeps, chain: ScopeChain): string {
  const memories = activeOnly(deps.store.inScopes(chain));
  const sections = chain.map((scope) => scopeSection(scope, memories));
  return [...productLine(deps, chain), ...sections].join("\n\n");
}

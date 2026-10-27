import type { MemoryId } from "../../model/id";
import { isAlwaysOn, KIND_DELIVERY, KINDS, type Kind } from "../../model/kind";
import type { Memory } from "../../model/memory";
import { type ScopeChain, scopeKey } from "../../model/scope";
import { alwaysOnText } from "./always-on";
import { INSTRUCTIONS } from "./instructions";

interface BlockInput {
  readonly chain: ScopeChain;
  // Active memories on the chain; superseded ones are already left out.
  readonly memories: readonly Memory[];
  readonly indexLines: number;
}

function indexLine(memory: Memory): string {
  return `- [${memory.id}] ${memory.title}`;
}

// Broadest scope first, so the narrowest, which wins a conflict, is read last.
function byScope(
  chain: ScopeChain,
  memories: readonly Memory[],
  render: (memory: Memory) => string,
): string[] {
  return chain.flatMap((scope) => {
    const key = scopeKey(scope);
    const lines = memories.filter((memory) => scopeKey(memory.scope) === key).map(render);
    return lines.length === 0 ? [] : [`#### ${key}`, ...lines];
  });
}

function section(heading: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : ["", heading, ...lines];
}

function plural(kind: Kind): string {
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}s`;
}

// Most recently updated first, cut to the cap, then grouped by scope for reading.
function indexEntries(memories: readonly Memory[], limit: number): Memory[] {
  return memories
    .filter((memory) => KIND_DELIVERY[memory.kind] === "index")
    .toSorted((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, limit);
}

interface SessionBlock {
  readonly text: string;
  // Exactly the memories the text contains.
  readonly shown: readonly MemoryId[];
}

// The fixed instructions, then each always-on kind in full (rules before preferences), then the
// index of facts and decisions.
export function renderSessionBlock(input: BlockInput): SessionBlock {
  const keys = new Set(input.chain.map(scopeKey));
  const onChain = input.memories.filter((memory) => keys.has(scopeKey(memory.scope)));
  const alwaysOnKinds = KINDS.filter(isAlwaysOn);
  const alwaysOn = onChain.filter((memory) => isAlwaysOn(memory.kind));
  const index = indexEntries(onChain, input.indexLines);
  const text = [
    INSTRUCTIONS,
    ...alwaysOnKinds.flatMap((kind) =>
      section(
        `### ${plural(kind)}`,
        byScope(
          input.chain,
          alwaysOn.filter((memory) => memory.kind === kind),
          alwaysOnText,
        ),
      ),
    ),
    ...section("### Index (memory_read for the full text)", byScope(input.chain, index, indexLine)),
  ].join("\n");
  return { text, shown: [...alwaysOn, ...index].map((memory) => memory.id) };
}

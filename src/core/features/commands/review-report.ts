import type { MemoryId } from "../../model/id";
import { activeOnly, type Memory } from "../../model/memory";
import type { ScopeChain } from "../../model/scope";
import { unmetRequirements } from "../../model/validate";
import type { MemoryStore } from "../../store/memory-store";
import { memoryLine } from "../memory-line";

// What the telemetry noticed in the chain: facts and decisions that fell out of the session
// index, and gotchas that fire often enough to be a nuisance.
export interface ReviewSignals {
  readonly leftIndex: readonly MemoryId[];
  readonly noisy: readonly MemoryId[];
}

type ReviewStore = Pick<MemoryStore, "get" | "inScopes">;

const NOTHING_TO_REVIEW =
  "Nothing needs review: no memory is superseded or incomplete, none left the session index and no gotcha fires often.";

const OFFER =
  "Offer the user, for each: keep it; forget it (memory_forget); merge it into another memory (memory_update on that one, then memory_forget this); or turn it into a rule (memory_save with kind rule and a why, then memory_forget this).";

function supersededLines(memories: readonly Memory[]): string[] {
  const active = new Set(activeOnly(memories).map((memory) => memory.id));
  return memories
    .filter((memory) => !active.has(memory.id))
    .map((memory) => {
      const replacement = memories.find((other) => other.supersedes === memory.id);
      const suffix = replacement === undefined ? "" : ` (replaced by [${replacement.id}])`;
      return `- ${memoryLine(memory)}${suffix}`;
    });
}

function missingFieldLines(memories: readonly Memory[]): string[] {
  return activeOnly(memories).flatMap((memory) => {
    const missing = unmetRequirements(memory);
    return missing.length === 0 ? [] : [`- ${memoryLine(memory)} (missing ${missing.join(", ")})`];
  });
}

function signalLines(store: ReviewStore, ids: readonly MemoryId[]): string[] {
  return ids.flatMap((id) => {
    const memory = store.get(id);
    return memory === undefined ? [] : [`- ${memoryLine(memory)}`];
  });
}

export function reviewReport(
  store: ReviewStore,
  chain: ScopeChain,
  signals: ReviewSignals,
): string {
  const sections = [
    {
      heading: "Superseded, still on disk:",
      lines: supersededLines(store.inScopes(chain)),
    },
    {
      heading: "Missing a required field, fix with memory_update:",
      lines: missingFieldLines(store.inScopes(chain)),
    },
    {
      heading: "Left the session index, still searchable:",
      lines: signalLines(store, signals.leftIndex),
    },
    { heading: "Gotchas that fire often:", lines: signalLines(store, signals.noisy) },
  ].filter((section) => section.lines.length > 0);
  if (sections.length === 0) {
    return NOTHING_TO_REVIEW;
  }
  return [...sections.map(({ heading, lines }) => [heading, ...lines].join("\n")), OFFER].join(
    "\n\n",
  );
}

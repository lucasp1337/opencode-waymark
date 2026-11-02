import type { Memory } from "../../model/memory";
import { activeOnly, TRIGGER_FIELDS, type TriggerField } from "../../model/memory";
import type { ScopeChain } from "../../model/scope";
import type { MemoryStore } from "../../store/memory-store";
import { memoryLine } from "../memory-line";
import { type RepoTriggerDeps, repoTriggersSection } from "./repo-triggers";

type TriggersDeps = RepoTriggerDeps & { readonly store: Pick<MemoryStore, "inScopes"> };

// Memories grouped by the values of one trigger field, values in alphabetical order.
function groupByValue(memories: readonly Memory[], field: TriggerField): Map<string, Memory[]> {
  const groups = new Map<string, Memory[]>();
  for (const memory of memories) {
    for (const value of memory.triggers?.[field] ?? []) {
      groups.set(value, [...(groups.get(value) ?? []), memory]);
    }
  }
  return new Map([...groups].sort(([a], [b]) => a.localeCompare(b)));
}

function valueSection(memories: readonly Memory[], field: TriggerField): string | undefined {
  const groups = groupByValue(memories, field);
  if (groups.size === 0) {
    return undefined;
  }
  const lines = [...groups].flatMap(([value, members]) => [
    `### ${value}`,
    ...members.map((memory) => `- ${memoryLine(memory)}`),
  ]);
  return [`## ${field}`, ...lines].join("\n");
}

async function sectionFor(
  deps: TriggersDeps,
  chain: ScopeChain,
  memories: readonly Memory[],
  field: TriggerField,
): Promise<string | undefined> {
  return field === "repos"
    ? await repoTriggersSection(deps, chain, memories)
    : valueSection(memories, field);
}

// The triggered memories reachable from the session, by trigger field and then by trigger value;
// all fields unless one is asked for.
export async function triggersReport(
  deps: TriggersDeps,
  chain: ScopeChain,
  field: TriggerField | undefined,
): Promise<string> {
  const memories = activeOnly(deps.store.inScopes(chain));
  const fields = field === undefined ? TRIGGER_FIELDS : [field];
  const sections = await Promise.all(fields.map((one) => sectionFor(deps, chain, memories, one)));
  const shown = sections.filter((section) => section !== undefined);
  if (shown.length > 0) {
    return shown.join("\n\n");
  }
  return field === undefined
    ? "No memory reachable from this session has triggers."
    : `No memory reachable from this session has triggers.${field}.`;
}

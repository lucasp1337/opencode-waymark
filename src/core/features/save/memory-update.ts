import type { Memory } from "../../model/memory";
import { applyPatch, parsePatch } from "../../model/validate";
import type { ToolDef } from "../../port";
import { CONTENT_PROPERTIES, ID_PROPERTY } from "../content-schema";
import { lookupMemory } from "../memory-lookup";
import type { ToolDeps } from "../tool-deps";
import { persistMemory } from "./persist";

async function update(deps: ToolDeps, input: unknown): Promise<string> {
  const existing = lookupMemory(deps.store, input);
  if (!existing.ok) {
    return `Not updated: ${existing.error}`;
  }
  const patch = parsePatch(input);
  if (patch.ok && Object.keys(patch.value).length === 0) {
    return "Not updated: give at least one of title, body, why, howToApply, triggers or locator.";
  }
  const content = patch.ok ? applyPatch(existing.value, patch.value) : patch;
  if (!content.ok) {
    return `Not updated: ${content.error.join("; ")}`;
  }
  const memory: Memory = {
    ...existing.value,
    ...content.value,
    updated: deps.now().toISOString(),
  };
  return await persistMemory(deps, memory, "updated");
}

export function memoryUpdateTool(deps: ToolDeps): ToolDef {
  return {
    name: "memory_update",
    description:
      "Change fields of an existing memory by id, to correct or extend it. Fields left out stay as they are. Use this instead of saving a duplicate.",
    inputSchema: {
      type: "object",
      properties: { id: ID_PROPERTY, ...CONTENT_PROPERTIES },
      required: ["id"],
    },
    execute: (input) => update(deps, input),
  };
}

import type { ToolDef } from "../../port";
import { encodeMemory } from "../../store/codec";
import { ID_PROPERTY } from "../content-schema";
import { lookupMemory } from "../memory-lookup";
import type { ToolDeps } from "../tool-deps";

export function memoryReadTool(deps: Pick<ToolDeps, "store">): ToolDef {
  return {
    name: "memory_read",
    description: "Read one memory in full by id.",
    inputSchema: { type: "object", properties: { id: ID_PROPERTY }, required: ["id"] },
    execute: (input) => {
      const memory = lookupMemory(deps.store, input);
      return Promise.resolve(memory.ok ? encodeMemory(memory.value) : memory.error);
    },
  };
}

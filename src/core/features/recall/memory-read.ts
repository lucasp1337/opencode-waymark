import type { ToolDef } from "../../port";
import { encodeMemory } from "../../store/codec";
import type { Telemetry } from "../../telemetry/telemetry";
import { ID_PROPERTY } from "../content-schema";
import { lookupMemory } from "../memory-lookup";
import type { ToolDeps } from "../tool-deps";

interface ReadDeps extends Pick<ToolDeps, "store"> {
  readonly counters: Pick<Telemetry, "recordRead">;
}

export function memoryReadTool(deps: ReadDeps): ToolDef {
  return {
    name: "memory_read",
    description:
      "Read one memory in full by id, including its dates. Check a memory before relying on it or updating it.",
    inputSchema: { type: "object", properties: { id: ID_PROPERTY }, required: ["id"] },
    execute: (input) => {
      const memory = lookupMemory(deps.store, input);
      if (!memory.ok) {
        return Promise.resolve(memory.error);
      }
      deps.counters.recordRead(memory.value.id);
      return Promise.resolve(encodeMemory(memory.value));
    },
  };
}

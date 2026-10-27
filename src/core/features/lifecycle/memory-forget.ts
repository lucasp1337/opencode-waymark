import { notify } from "../../notify";
import type { ToolDef } from "../../port";
import { ID_PROPERTY } from "../content-schema";
import { memoryLine } from "../memory-line";
import { lookupMemory } from "../memory-lookup";
import type { ToolDeps } from "../tool-deps";

async function forget(deps: ToolDeps, input: unknown): Promise<string> {
  const memory = lookupMemory(deps.store, input);
  if (!memory.ok) {
    return `Not forgotten: ${memory.error}`;
  }
  deps.store.forget(memory.value);
  await notify(deps.host, `waymark · forgot ${memory.value.kind} · ${memory.value.title}`);
  return `Forgot ${memoryLine(memory.value)}`;
}

export function memoryForgetTool(deps: ToolDeps): ToolDef {
  return {
    name: "memory_forget",
    description:
      "Delete a memory file for good. Only when the user asks to forget it or it is plainly wrong.",
    inputSchema: { type: "object", properties: { id: ID_PROPERTY }, required: ["id"] },
    execute: (input) => forget(deps, input),
  };
}

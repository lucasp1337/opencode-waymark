import type { HostPort, ToolDef } from "../port";

// The host does not isolate plugin errors, so an unexpected failure becomes a tool message plus a
// log entry instead of a failed call.
export function guardedTool(host: Pick<HostPort, "log">, def: ToolDef): ToolDef {
  return {
    ...def,
    async execute(input, ctx) {
      try {
        return await def.execute(input, ctx);
      } catch (error) {
        host.log("error", "tool failed", { tool: def.name, error: String(error) });
        return `${def.name} failed inside Waymark (${String(error)}); details are in the Waymark log.`;
      }
    },
  };
}

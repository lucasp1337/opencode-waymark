import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { HostPort } from "../../src/core/port";
import { createV1Adapter } from "../../src/host/v1";
import { createFileLogger, logFilePath } from "../../src/logger";

function registerSessionTools(host: HostPort, input: PluginInput): void {
  host.registerTool({
    name: "probe_delete_other",
    description: "Delete the session with the given id.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    execute: async (args) => {
      const id = String(Object.getOwnPropertyDescriptor(args, "id")?.value);
      const result = await input.client.session.delete({ path: { id } });
      host.log("info", "probe.delete.result", { data: result.data, error: result.error });
      return "deleted";
    },
  });
}

function registerProbes(host: HostPort): void {
  host.registerTool({
    name: "probe_echo",
    description: "Echo the given message back. Used to verify plugin tools.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "text to echo" },
        times: { type: "number" },
        mode: { type: "string", enum: ["plain", "loud"] },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["message"],
    },
    execute: (input, ctx) => {
      host.log("info", "probe.tool.execute", { input, ctx });
      return Promise.resolve(`echo:${JSON.stringify(input)}`);
    },
  });
  host.registerTool({
    name: "probe_toast",
    description: "Show a toast with the given message.",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
    execute: async (input) => {
      try {
        await host.toast(
          String(Object.getOwnPropertyDescriptor(input, "message")?.value),
          "success",
        );
        host.log("info", "probe.toast.ok");
      } catch (error) {
        host.log("error", "probe.toast.failed", { error: String(error) });
      }
      return "toast attempted";
    },
  });
  host.registerTool({
    name: "probe_session",
    description: "Log the session metadata of the current session.",
    inputSchema: { type: "object", properties: {} },
    execute: async (_input, ctx) => {
      const meta = await host.sessionMeta(ctx.sessionID);
      host.log("info", "probe.session.meta", { meta, ctx });
      return "session logged";
    },
  });
  host.registerCommand(
    "waymark-probe",
    "Waymark probe command",
    "Reply with exactly: PROBE_COMMAND_OK $ARGUMENTS",
  );
  host.onSystem((sessionID) => {
    host.log("info", "probe.system", { sessionID });
    return Promise.resolve("The project codeword is WAYMARK_SYSTEM_MARKER_7Q2.");
  });
  host.onUserMessage((sessionID, text) => {
    host.log("info", "probe.user", { sessionID, text });
    return Promise.resolve();
  });
  host.onToolAfter((call) => {
    host.log("info", "probe.tool.after", { call });
    return Promise.resolve(`WAYMARK_PROBE_${call.tool}`);
  });
  host.onSessionEvent((event) => {
    host.log("info", "probe.session.event", { event });
    return Promise.resolve();
  });
  host.onCompaction((sessionID) => {
    host.log("info", "probe.compaction", { sessionID });
    return Promise.resolve("The summary must contain the exact token WAYMARK_COMPACT_MARKER_4K9.");
  });
}

const probePlugin: Plugin = (input) => {
  const logger = createFileLogger(logFilePath(process.env), () => new Date());
  const adapter = createV1Adapter(input, logger);
  registerProbes(adapter.host);
  registerSessionTools(adapter.host, input);
  return Promise.resolve(adapter.hooks());
};

export default { id: "waymark-probe", server: probePlugin };

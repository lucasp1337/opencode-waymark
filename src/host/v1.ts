import { type Config, type Hooks, type Plugin, tool } from "@opencode-ai/plugin";
import type {
  Capabilities,
  HostPort,
  SessionEvent,
  SessionMeta,
  ToolCallInfo,
  ToolDef,
} from "../core/port";
import { activate } from "../core/runtime";
import { systemDeps } from "../core/system";
import { createFileLogger, type Logger, logFilePath } from "../logger";
import { attempt, collect, each } from "./isolation";
import { buildShape, type SchemaBuilder } from "./schema";
import { summarize } from "./summarize";
import { commandOf, touchedPaths } from "./tool-args";
import { appendText, canAppend } from "./tool-output";

type Node = InstanceType<typeof tool.schema.ZodType>;

const z = tool.schema;

const zodBuilder: SchemaBuilder<Node> = {
  string: () => z.string(),
  number: () => z.number(),
  boolean: () => z.boolean(),
  enumOf: (values) => z.enum(values),
  array: (item) => z.array(item),
  object: (shape) => z.object(shape),
  optional: (schema) => schema.optional(),
  describe: (schema, text) => schema.describe(text),
};

const CAPABILITIES: Capabilities = {
  systemInjection: true,
  toolOutputMutation: true,
  compactionHook: true,
  toast: true,
};

interface Registry {
  tools: NonNullable<Hooks["tool"]>;
  commands: NonNullable<Config["command"]>;
  system: Array<(sessionID: string) => Promise<string | null>>;
  userMessage: Array<(sessionID: string, text: string) => Promise<void>>;
  toolAfter: Array<(call: ToolCallInfo) => Promise<string | null>>;
  sessionEvent: Array<(e: SessionEvent) => Promise<void>>;
  compaction: Array<(sessionID: string) => Promise<string | null>>;
  dispose: Array<() => void>;
}

function emptyRegistry(): Registry {
  return {
    tools: {},
    commands: {},
    system: [],
    userMessage: [],
    toolAfter: [],
    sessionEvent: [],
    compaction: [],
    dispose: [],
  };
}

function toSdkTool(def: ToolDef): NonNullable<Hooks["tool"]>[string] {
  return tool({
    description: def.description,
    args: buildShape(def.inputSchema, zodBuilder),
    execute: (args, ctx) => def.execute(args, { sessionID: ctx.sessionID, agent: ctx.agent }),
  });
}

export interface V1Adapter {
  host: HostPort;
  onDispose(fn: () => void): void;
  hooks(): Hooks;
}

// The slice of the SDK client the adapter uses, so tests can stub it without a full client.
export interface AdapterClient {
  session: {
    get(options: { path: { id: string } }): Promise<{
      data: { id: string; parentID?: string; directory: string } | undefined;
    }>;
  };
  tui: {
    showToast(options: {
      body: { message: string; variant: "info" | "success" | "warning" };
    }): Promise<unknown>;
  };
}

export function createV1Adapter(input: { client: AdapterClient }, logger: Logger): V1Adapter {
  const registry = emptyRegistry();
  // chat.message is the only hook that names a session's agent; sessionMeta reports it back.
  const agents = new Map<string, string>();

  const host: HostPort = {
    capabilities: CAPABILITIES,
    registerTool: (def) => {
      registry.tools[def.name] = toSdkTool(def);
    },
    registerCommand: (name, description, template) => {
      registry.commands[name] = { template, description };
    },
    onSystem: (fn) => registry.system.push(fn),
    onUserMessage: (fn) => registry.userMessage.push(fn),
    onToolAfter: (fn) => registry.toolAfter.push(fn),
    onSessionEvent: (fn) => registry.sessionEvent.push(fn),
    onCompaction: (fn) => registry.compaction.push(fn),
    sessionMeta: async (sessionID): Promise<SessionMeta> => {
      const result = await input.client.session.get({ path: { id: sessionID } });
      if (result.data === undefined) {
        throw new Error(`session ${sessionID} not found`);
      }
      const { id, parentID, directory } = result.data;
      const agent = agents.get(id);
      return {
        id,
        directory,
        ...(parentID === undefined ? {} : { parentID }),
        ...(agent === undefined ? {} : { agent }),
      };
    },
    toast: async (message, variant = "info") => {
      await input.client.tui.showToast({ body: { message, variant } });
    },
    log: (level, msg, data) => logger.log(level, msg, data),
  };

  const trace = (hook: string, hookInput: unknown, output: unknown): void => {
    logger.log("debug", "hook", {
      hook,
      input: summarize(hookInput),
      outputKeys: output !== null && typeof output === "object" ? Object.keys(output) : [],
    });
  };

  const dispatchSessionEvent = async (event: SessionEvent): Promise<void> => {
    if (event.type === "deleted") {
      agents.delete(event.sessionID);
    }
    await each(logger, "event", registry.sessionEvent, event);
  };

  // The host's hooks resolve to void; the outcome of an attempt is for the log, not the host.
  const guarded = async (hook: string, run: () => Promise<void> | void): Promise<void> => {
    await attempt(logger, hook, run);
  };

  return {
    host,
    onDispose: (fn) => registry.dispose.push(fn),
    hooks: () => ({
      tool: registry.tools,
      config: (config) =>
        guarded("config", () => {
          trace("config", config, {});
          config.command = { ...config.command, ...registry.commands };
        }),
      event: ({ event }) =>
        guarded("event", async () => {
          trace("event", event, {});
          const mapped = sessionEventOf(event);
          if (mapped !== undefined) {
            await dispatchSessionEvent(mapped);
          }
        }),
      "chat.message": (hookInput, output) =>
        guarded("chat.message", async () => {
          trace("chat.message", hookInput, output);
          if (hookInput.agent !== undefined) {
            agents.set(hookInput.sessionID, hookInput.agent);
          }
          // Host-added parts (file mentions, ignored text) are not what the user typed.
          const text = output.parts.flatMap((part) =>
            part.type === "text" && part.synthetic !== true && part.ignored !== true
              ? part.text
              : [],
          );
          await each(
            logger,
            "chat.message",
            registry.userMessage,
            hookInput.sessionID,
            text.join("\n"),
          );
        }),
      "experimental.chat.system.transform": (hookInput, output) =>
        guarded("system.transform", async () => {
          trace("experimental.chat.system.transform", hookInput, output);
          if (hookInput.sessionID !== undefined) {
            output.system.push(
              ...(await collect(logger, "system.transform", registry.system, hookInput.sessionID)),
            );
          }
        }),
      "tool.execute.before": (hookInput, output) =>
        guarded("tool.execute.before", () => {
          trace("tool.execute.before", hookInput, output);
        }),
      "tool.execute.after": (hookInput, output) =>
        guarded("tool.execute.after", async () => {
          trace("tool.execute.after", hookInput, output);
          const command = commandOf(hookInput.args);
          const call: ToolCallInfo = {
            sessionID: hookInput.sessionID,
            tool: hookInput.tool,
            args: hookInput.args,
            touchedPaths: touchedPaths(hookInput.args),
            appendable: canAppend(output),
            ...(command === undefined ? {} : { command }),
          };
          const texts = await collect(logger, "tool.execute.after", registry.toolAfter, call);
          if (texts.length > 0) {
            appendText(output, texts.join("\n"));
          }
        }),
      "experimental.session.compacting": (hookInput, output) =>
        guarded("compacting", async () => {
          trace("experimental.session.compacting", hookInput, output);
          output.context.push(
            ...(await collect(logger, "compacting", registry.compaction, hookInput.sessionID)),
          );
        }),
      dispose: () =>
        guarded("dispose", async () => {
          trace("dispose", {}, {});
          await each(logger, "dispose", registry.dispose);
        }),
    }),
  };
}

function sessionEventOf(event: Parameters<NonNullable<Hooks["event"]>>[0]["event"]) {
  switch (event.type) {
    case "session.created":
      return { type: "created", sessionID: event.properties.info.id } satisfies SessionEvent;
    case "session.deleted":
      return { type: "deleted", sessionID: event.properties.info.id } satisfies SessionEvent;
    case "session.idle":
      return { type: "idle", sessionID: event.properties.sessionID } satisfies SessionEvent;
    default:
      return undefined;
  }
}

export const server: Plugin = (input, options) => {
  const logger = createFileLogger(logFilePath(process.env), () => new Date());
  logger.log("info", "plugin loaded", {
    inputKeys: Object.keys(input),
    directory: input.directory,
  });
  const adapter = createV1Adapter(input, logger);
  adapter.onDispose(activate(adapter.host, { ...systemDeps(process.env), options }).dispose);
  return Promise.resolve(adapter.hooks());
};

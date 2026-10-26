import { type Config, type Hooks, type Plugin, type PluginInput, tool } from "@opencode-ai/plugin";
import { createFileLogger, type Logger, logFilePath } from "../logger";
import type {
  Capabilities,
  HostPort,
  SessionEvent,
  SessionMeta,
  ToolCallInfo,
  ToolDef,
} from "./port";
import { buildShape, type SchemaBuilder } from "./schema";
import { summarize } from "./summarize";
import { commandOf, touchedPaths } from "./tool-args";

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
  };
}

function toSdkTool(def: ToolDef): NonNullable<Hooks["tool"]>[string] {
  return tool({
    description: def.description,
    args: buildShape(def.inputSchema, zodBuilder),
    execute: async (args, ctx) => {
      const output = await def.execute(args, { sessionID: ctx.sessionID, agent: ctx.agent });
      return output;
    },
  });
}

async function collect<A extends unknown[]>(
  fns: Array<(...args: A) => Promise<string | null>>,
  ...args: A
): Promise<string[]> {
  const texts: string[] = [];
  for (const fn of fns) {
    const text = await fn(...args);
    if (text !== null) {
      texts.push(text);
    }
  }
  return texts;
}

export interface V1Adapter {
  host: HostPort;
  hooks(): Hooks;
}

export function createV1Adapter(input: PluginInput, logger: Logger): V1Adapter {
  const registry = emptyRegistry();

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
      return parentID === undefined ? { id, directory } : { id, parentID, directory };
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

  const guarded = async (hook: string, run: () => Promise<void> | void): Promise<void> => {
    try {
      await run();
    } catch (error) {
      logger.log("error", "hook failed", { hook, error: String(error) });
    }
  };

  return {
    host,
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
          if (mapped === undefined) {
            return;
          }
          for (const fn of registry.sessionEvent) {
            await fn(mapped);
          }
        }),
      "chat.message": (hookInput, output) =>
        guarded("chat.message", async () => {
          trace("chat.message", hookInput, output);
          const text = output.parts.flatMap((part) => (part.type === "text" ? part.text : []));
          for (const fn of registry.userMessage) {
            await fn(hookInput.sessionID, text.join("\n"));
          }
        }),
      "experimental.chat.system.transform": (hookInput, output) =>
        guarded("system.transform", async () => {
          trace("experimental.chat.system.transform", hookInput, output);
          if (hookInput.sessionID !== undefined) {
            output.system.push(...(await collect(registry.system, hookInput.sessionID)));
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
            ...(command === undefined ? {} : { command }),
          };
          const texts = await collect(registry.toolAfter, call);
          output.output = [output.output, ...texts].join("\n");
        }),
      "experimental.session.compacting": (hookInput, output) =>
        guarded("compacting", async () => {
          trace("experimental.session.compacting", hookInput, output);
          output.context.push(...(await collect(registry.compaction, hookInput.sessionID)));
        }),
      dispose: () =>
        guarded("dispose", () => {
          trace("dispose", {}, {});
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

export const server: Plugin = (input) => {
  const logger = createFileLogger(logFilePath(process.env), () => new Date());
  logger.log("info", "plugin loaded", {
    inputKeys: Object.keys(input),
    directory: input.directory,
  });
  return Promise.resolve(createV1Adapter(input, logger).hooks());
};

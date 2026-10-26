import type {
  Capabilities,
  HostPort,
  LogLevel,
  SessionEvent,
  SessionMeta,
  ToolCallInfo,
  ToolDef,
} from "../src/core/port";

interface LogEntry {
  level: LogLevel;
  msg: string;
  data?: unknown;
}

export interface FakeHost extends HostPort {
  tools: Map<string, ToolDef>;
  commands: Map<string, { description: string; template: string }>;
  toasts: string[];
  logs: LogEntry[];
  sessions: Map<string, SessionMeta>;
  callTool(name: string, input: unknown, sessionID: string): Promise<string>;
  emitSystem(sessionID: string): Promise<string[]>;
  emitUserMessage(sessionID: string, text: string): Promise<void>;
  emitToolAfter(call: ToolCallInfo): Promise<string[]>;
  emitSessionEvent(event: SessionEvent): Promise<void>;
  emitCompaction(sessionID: string): Promise<string[]>;
}

const ALL_CAPABILITIES: Capabilities = {
  systemInjection: true,
  toolOutputMutation: true,
  compactionHook: true,
  toast: true,
};

async function gather<A>(
  fns: Array<(arg: A) => Promise<string | null>>,
  arg: A,
): Promise<string[]> {
  const texts: string[] = [];
  for (const fn of fns) {
    const text = await fn(arg);
    if (text !== null) {
      texts.push(text);
    }
  }
  return texts;
}

export function createFakeHost(capabilities: Capabilities = ALL_CAPABILITIES): FakeHost {
  const system: Array<(sessionID: string) => Promise<string | null>> = [];
  const userMessage: Array<(sessionID: string, text: string) => Promise<void>> = [];
  const toolAfter: Array<(call: ToolCallInfo) => Promise<string | null>> = [];
  const sessionEvent: Array<(event: SessionEvent) => Promise<void>> = [];
  const compaction: Array<(sessionID: string) => Promise<string | null>> = [];
  const tools = new Map<string, ToolDef>();
  const sessions = new Map<string, SessionMeta>();

  return {
    capabilities,
    tools,
    commands: new Map(),
    toasts: [],
    logs: [],
    sessions,
    registerTool: (def) => {
      tools.set(def.name, def);
    },
    registerCommand(name, description, template) {
      this.commands.set(name, { description, template });
    },
    onSystem: (fn) => system.push(fn),
    onUserMessage: (fn) => userMessage.push(fn),
    onToolAfter: (fn) => toolAfter.push(fn),
    onSessionEvent: (fn) => sessionEvent.push(fn),
    onCompaction: (fn) => compaction.push(fn),
    sessionMeta(sessionID) {
      const meta = sessions.get(sessionID);
      return meta === undefined
        ? Promise.reject(new Error(`unknown session ${sessionID}`))
        : Promise.resolve(meta);
    },
    toast(message) {
      this.toasts.push(message);
      return Promise.resolve();
    },
    log(level, msg, data) {
      this.logs.push(data === undefined ? { level, msg } : { level, msg, data });
    },
    callTool(name, input, sessionID) {
      const def = tools.get(name);
      return def === undefined
        ? Promise.reject(new Error(`unknown tool ${name}`))
        : def.execute(input, { sessionID });
    },
    emitSystem: (sessionID) => gather(system, sessionID),
    emitToolAfter: (call) => gather(toolAfter, call),
    emitCompaction: (sessionID) => gather(compaction, sessionID),
    async emitUserMessage(sessionID, text) {
      for (const fn of userMessage) {
        await fn(sessionID, text);
      }
    },
    async emitSessionEvent(event) {
      for (const fn of sessionEvent) {
        await fn(event);
      }
    },
  };
}

export interface Capabilities {
  systemInjection: boolean;
  toolOutputMutation: boolean;
  compactionHook: boolean;
  toast: boolean;
}

export type JsonSchema =
  | { type: "string"; description?: string; enum?: readonly string[] }
  | { type: "number" | "boolean"; description?: string }
  | { type: "array"; items: JsonSchema; description?: string }
  | JsonSchemaObject;

export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
}

interface ToolCtx {
  sessionID: string;
  agent?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
  execute(input: unknown, ctx: ToolCtx): Promise<string>;
}

export interface ToolCallInfo {
  sessionID: string;
  tool: string;
  args: unknown;
  touchedPaths: string[];
  command?: string;
  // False when the host cannot carry appended text for this call; recall waits for the next one.
  appendable: boolean;
}

export interface SessionMeta {
  id: string;
  parentID?: string;
  agent?: string;
  directory: string;
}

export type SessionEvent = {
  type: "created" | "idle" | "deleted";
  sessionID: string;
};

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface HostPort {
  capabilities: Capabilities;
  registerTool(def: ToolDef): void;
  registerCommand(name: string, description: string, template: string): void;
  onSystem(fn: (sessionID: string) => Promise<string | null>): void;
  onUserMessage(fn: (sessionID: string, text: string) => Promise<void>): void;
  onToolAfter(fn: (call: ToolCallInfo) => Promise<string | null>): void;
  onSessionEvent(fn: (e: SessionEvent) => Promise<void>): void;
  onCompaction(fn: (sessionID: string) => Promise<string | null>): void;
  sessionMeta(sessionID: string): Promise<SessionMeta>;
  toast(message: string, variant?: "info" | "success" | "warning"): Promise<void>;
  log(level: LogLevel, msg: string, data?: unknown): void;
}

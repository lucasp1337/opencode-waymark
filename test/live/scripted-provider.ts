import { at, type Json, type LiveEnv, parseJson, writeFixture } from "./harness";

// A scripted OpenAI-compatible provider stands in for the model wherever a test needs a tool called
// with exact arguments: the outcome then depends on Waymark and opencode, not on what a model does.
const PROVIDER = "scripted";
const MODEL = "script";
// opencode offers apply_patch instead of edit and write to model ids containing "gpt-".
const PATCH_MODEL = "gpt-script";

export const SCRIPTED_MODEL = `${PROVIDER}/${MODEL}`;
export const SCRIPTED_PATCH_MODEL = `${PROVIDER}/${PATCH_MODEL}`;
export const SCRIPTED_MODEL_REF = { providerID: PROVIDER, modelID: MODEL };

// A conversation whose user text contains this gets a plain reply instead of the script, which keeps
// a subagent started by a scripted task call from running the script again.
export const PLAIN_REPLY = "WAYMARK_PLAIN_REPLY";

export interface ScriptedCall {
  tool: string;
  args: { [key: string]: Json };
}

export interface ScriptedProvider {
  // The text of every tool result opencode sent back, in the order the requests arrived.
  toolResults(): string[];
  // Every request body as received, for checks on what opencode put in front of the model.
  requestBodies(): string[];
  stop(): void;
}

function sse(chunks: Json[]): Response {
  const body = [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), "data: [DONE]\n\n"];
  return new Response(body.join(""), { headers: { "content-type": "text/event-stream" } });
}

function chunk(delta: Json, finishReason: string | null): Json {
  return {
    id: "chatcmpl-scripted",
    object: "chat.completion.chunk",
    created: 0,
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function toolCallReply(call: ScriptedCall, step: number): Response {
  const toolCall = {
    index: 0,
    id: `call_scripted_${step}`,
    type: "function",
    function: { name: call.tool, arguments: JSON.stringify(call.args) },
  };
  return sse([chunk({ role: "assistant", tool_calls: [toolCall] }, null), chunk({}, "tool_calls")]);
}

function textReply(): Response {
  return sse([chunk({ role: "assistant", content: "done" }, null), chunk({}, "stop")]);
}

function messagesOf(request: Json): Json[] {
  const messages = at(request, "messages");
  return Array.isArray(messages) ? messages : [];
}

// Message content is either a string or a list of text parts.
function textOf(message: Json): string {
  const content = at(message, "content");
  if (typeof content === "string") {
    return content;
  }
  return Array.isArray(content)
    ? content.map((part) => String(at(part, "text") ?? "")).join("")
    : "";
}

function withRole(request: Json, role: string): Json[] {
  return messagesOf(request).filter((message) => at(message, "role") === role);
}

// Each tool result in the history moves the script one call on; past its end the model just replies.
function nextCall(request: Json, calls: readonly ScriptedCall[]): ScriptedCall | undefined {
  const hasTools = Array.isArray(at(request, "tools"));
  const plain = withRole(request, "user").some((message) => textOf(message).includes(PLAIN_REPLY));
  return hasTools && !plain ? calls[withRole(request, "tool").length] : undefined;
}

// Starts the provider and points the sandbox's opencode config at it; `config` adds other entries.
export function startScriptedProvider(
  env: LiveEnv,
  calls: readonly ScriptedCall[],
  config: { [key: string]: Json } = {},
): ScriptedProvider {
  const bodies: string[] = [];
  const results = new Map<string, string>();
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = await request.text();
      bodies.push(body);
      const parsed = parseJson(body);
      for (const message of withRole(parsed, "tool")) {
        results.set(String(at(message, "tool_call_id")), textOf(message));
      }
      const call = nextCall(parsed, calls);
      return call === undefined
        ? textReply()
        : toolCallReply(call, withRole(parsed, "tool").length);
    },
  });
  const provider = {
    npm: "@ai-sdk/openai-compatible",
    name: "Scripted",
    options: { baseURL: `http://127.0.0.1:${server.port}/v1` },
    models: {
      [MODEL]: { name: "Scripted", tool_call: true },
      [PATCH_MODEL]: { name: "Scripted patch", tool_call: true },
    },
  };
  writeFixture(
    env.configDir,
    "opencode.json",
    JSON.stringify({ ...config, provider: { [PROVIDER]: provider } }),
  );
  return {
    toolResults: () => [...results.values()],
    requestBodies: () => [...bodies],
    stop: () => server.stop(true),
  };
}

// One opencode run against a fresh script; the provider is stopped before the results are read.
export async function runScripted(
  env: LiveEnv,
  calls: readonly ScriptedCall[],
  options: {
    prompt?: string;
    args?: string[];
    config?: { [key: string]: Json };
    model?: string;
  } = {},
): Promise<ScriptedProvider> {
  const provider = startScriptedProvider(env, calls, options.config);
  try {
    await env.run(options.prompt ?? "go", options.args ?? [], options.model ?? SCRIPTED_MODEL);
  } finally {
    provider.stop();
  }
  return provider;
}

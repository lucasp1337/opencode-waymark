import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  at,
  type Json,
  type LiveEnv,
  liveEnvWithProbe,
  parseJson,
  probeLines,
  writeFixture,
} from "./harness";

// A scripted OpenAI-compatible provider makes the tool call deterministic: the first turn calls the
// given tool, every later request (tool result, title) gets a plain reply. opencode only offers
// apply_patch to model ids containing "gpt-", hence the model name.
const PROVIDER = "scripted";
const MODEL = "gpt-scripted";

interface ScriptedCall {
  tool: string;
  args: Record<string, string>;
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

function toolCallReply(call: ScriptedCall): Response {
  const toolCall = {
    index: 0,
    id: "call_scripted",
    type: "function",
    function: { name: call.tool, arguments: JSON.stringify(call.args) },
  };
  return sse([chunk({ role: "assistant", tool_calls: [toolCall] }, null), chunk({}, "tool_calls")]);
}

function textReply(): Response {
  return sse([chunk({ role: "assistant", content: "done" }, null), chunk({}, "stop")]);
}

function isFirstToolTurn(request: Json): boolean {
  const messages = at(request, "messages");
  const hasTools = Array.isArray(at(request, "tools"));
  const sawToolResult =
    Array.isArray(messages) && messages.some((message) => at(message, "role") === "tool");
  return hasTools && !sawToolResult;
}

function startScriptedProvider(call: ScriptedCall): { url: string; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = parseJson(await request.text());
      return isFirstToolTurn(body) ? toolCallReply(call) : textReply();
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, stop: () => server.stop(true) };
}

function useScriptedProvider(env: LiveEnv, baseURL: string): void {
  const provider = {
    npm: "@ai-sdk/openai-compatible",
    name: "Scripted",
    options: { baseURL },
    models: { [MODEL]: { name: "Scripted", tool_call: true } },
  };
  writeFixture(
    env.configDir,
    "opencode.json",
    JSON.stringify({ provider: { [PROVIDER]: provider } }),
  );
}

async function afterCallFor(call: ScriptedCall, env: LiveEnv): Promise<Json | undefined> {
  const provider = startScriptedProvider(call);
  useScriptedProvider(env, provider.url);
  const server = await env.serve();
  try {
    const sessionID = await server.newSession();
    const response = await server.api(`/session/${sessionID}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: { providerID: PROVIDER, modelID: MODEL },
        parts: [{ type: "text", text: "go" }],
      }),
    });
    await response.text();
  } finally {
    await server.stop();
    provider.stop();
  }
  return probeLines(env, "probe.tool.after")
    .map((line) => at(line, "call"))
    .find((logged) => at(logged, "tool") === call.tool);
}

describe("onToolAfter", () => {
  test("bash: the workdir argument arrives as a string and counts as a touched path", async () => {
    const env = liveEnvWithProbe();
    const workdir = join(env.workDir, "sub");
    mkdirSync(workdir);

    const call = await afterCallFor(
      { tool: "bash", args: { command: "echo hi", workdir, description: "Echo hi" } },
      env,
    );

    expect(at(call, "args", "workdir")).toBe(workdir);
    expect(at(call, "command")).toBe("echo hi");
    expect(at(call, "touchedPaths")).toEqual([workdir]);
  });

  test("apply_patch: patchText arrives as a string and its file header counts as a touched path", async () => {
    const env = liveEnvWithProbe();
    const patchText = [
      "*** Begin Patch",
      "*** Add File: hello.txt",
      "+hello",
      "*** End Patch",
    ].join("\n");

    const call = await afterCallFor({ tool: "apply_patch", args: { patchText } }, env);

    expect(at(call, "args", "patchText")).toBe(patchText);
    expect(at(call, "touchedPaths")).toEqual(["hello.txt"]);
  });
});

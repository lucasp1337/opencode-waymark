// Minimal MCP server over stdio: one tool, `say`, enough to exercise MCP tool hooks.
const reply = (id: unknown, result: unknown) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);

const handlers: Record<string, (id: unknown) => void> = {
  initialize: (id) =>
    reply(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "echo", version: "0.0.0" },
    }),
  "tools/list": (id) =>
    reply(id, {
      tools: [
        {
          name: "say",
          description: "Say a fixed phrase.",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    }),
  "tools/call": (id) => reply(id, { content: [{ type: "text", text: "mcp says hi" }] }),
};

for await (const line of console) {
  const message = JSON.parse(line) as { id?: unknown; method: string };
  if (message.id !== undefined) {
    handlers[message.method]?.(message.id);
  }
}

export {};

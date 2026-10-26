// Minimal stdio MCP server: one tool, no dependencies. Newline-delimited JSON-RPC.
interface Request {
  id?: number;
  method: string;
}

function respond(id: number, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

const handlers: Record<string, () => unknown> = {
  initialize: () => ({
    protocolVersion: "2024-11-05",
    capabilities: { tools: {} },
    serverInfo: { name: "ping", version: "1.0.0" },
  }),
  "tools/list": () => ({
    tools: [
      {
        name: "ping",
        description: "Returns the text pong.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }),
  "tools/call": () => ({ content: [{ type: "text", text: "pong" }] }),
};

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines.filter((l) => l.trim().length > 0)) {
    const request = JSON.parse(line) as Request;
    const handler = handlers[request.method];
    if (request.id !== undefined && handler) {
      respond(request.id, handler());
    }
  }
});

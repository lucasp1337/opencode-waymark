// tool.execute.after hands over three output shapes: { output: string } for built-in and plugin
// tools, an MCP result { content: [...] } whose text the host rebuilds after the hook, and nothing
// at all for a failed user-started subtask. Only the first two can carry appended text.
export function canAppend(output: unknown): boolean {
  if (typeof output !== "object" || output === null) {
    return false;
  }
  const text: unknown = Reflect.get(output, "output");
  const content: unknown = Reflect.get(output, "content");
  return typeof text === "string" || Array.isArray(content);
}

export function appendText(output: unknown, text: string): void {
  if (typeof output !== "object" || output === null) {
    return;
  }
  const current: unknown = Reflect.get(output, "output");
  if (typeof current === "string") {
    Reflect.set(output, "output", `${current}\n${text}`);
    return;
  }
  const content: unknown = Reflect.get(output, "content");
  if (Array.isArray(content)) {
    content.push({ type: "text", text });
  }
}

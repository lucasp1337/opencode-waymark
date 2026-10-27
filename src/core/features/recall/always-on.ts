import type { MemoryContent } from "../../model/memory";

// How a rule or preference appears in the session block. Budgets measure exactly this text.
export function alwaysOnText(content: MemoryContent): string {
  const body = content.body.trim();
  const lines = [
    `- ${content.title}`,
    ...(body === "" ? [] : body.split("\n").map((line) => `  ${line}`)),
    ...(content.why === undefined ? [] : [`  Why: ${content.why}`]),
  ];
  return lines.join("\n");
}

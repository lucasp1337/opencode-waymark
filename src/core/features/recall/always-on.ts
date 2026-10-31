import type { Memory } from "../../model/memory";
import { appliesLines, datedTitle } from "../memory-line";

// How a rule or preference appears in the session block. Budgets measure exactly this text.
export function alwaysOnText(memory: Memory): string {
  const body = memory.body.trim();
  const lines = [
    `- ${datedTitle(memory)}`,
    ...(body === "" ? [] : body.split("\n").map((line) => `  ${line}`)),
    ...(memory.why === undefined ? [] : [`  Why: ${memory.why}`]),
    ...appliesLines(memory).map((line) => `  ${line}`),
  ];
  return lines.join("\n");
}

import type { Memory } from "../../model/memory";
import type { NoisyThresholds } from "./lifecycle-settings";

// `fires` counts the fires within the thresholds' window.
export function isNoisy(memory: Memory, fires: number, noisy: NoisyThresholds): boolean {
  return memory.kind === "gotcha" && fires >= noisy.fires;
}

// The extra line for a gotcha that keeps firing, asking the agent to check with the user; null
// when it is not noisy. `firesBefore` is the count before the delivery that carries the line.
export function noisyGotchaLine(
  gotcha: Memory,
  firesBefore: number,
  noisy: NoisyThresholds,
): string | null {
  if (!isNoisy(gotcha, firesBefore, noisy)) {
    return null;
  }
  return `waymark · this gotcha fired ${firesBefore} times in ${noisy.days} days. Ask the user whether to keep it, forget it (memory_forget ${gotcha.id}), or turn it into a rule.`;
}

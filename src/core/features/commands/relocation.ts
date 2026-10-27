import type { Memory } from "../../model/memory";
import type { ScopeRef } from "../../model/scope";
import type { ToolDeps } from "../tool-deps";

export type RelocationDeps = Pick<ToolDeps, "host" | "store" | "now" | "caps">;

export function relocated(memory: Memory, scope: ScopeRef, now: Date): Memory {
  return { ...memory, scope, updated: now.toISOString() };
}

import type { MemoryId } from "./id";
import type { Kind } from "./kind";
import type { ScopeRef } from "./scope";

export const TRIGGER_FIELDS = ["paths", "commands", "tools", "keywords"] as const;

export type TriggerField = (typeof TRIGGER_FIELDS)[number];

// paths: globs on touched paths; commands: shell command prefixes; tools: exact tool names;
// keywords: whole words in the user's message.
export type Triggers = { readonly [F in TriggerField]?: readonly string[] };

// What the agent writes; everything else is assigned by Waymark.
export interface MemoryContent {
  readonly kind: Kind;
  readonly title: string;
  readonly body: string;
  readonly why?: string;
  readonly triggers?: Triggers;
}

declare const validContent: unique symbol;

// Content that passed its kind's requirements; only validate.ts can produce it.
export type ValidContent = MemoryContent & { readonly [validContent]: true };

export type Memory = ValidContent & {
  readonly id: MemoryId;
  readonly scope: ScopeRef;
  readonly created: string;
  readonly updated: string;
  readonly supersedes?: MemoryId;
};

export interface Origin {
  readonly id: MemoryId;
  readonly scope: ScopeRef;
  readonly now: Date;
  readonly supersedes?: MemoryId;
}

export function newMemory(content: ValidContent, origin: Origin): Memory {
  const stamp = origin.now.toISOString();
  return {
    ...content,
    id: origin.id,
    scope: origin.scope,
    created: stamp,
    updated: stamp,
    ...(origin.supersedes === undefined ? {} : { supersedes: origin.supersedes }),
  };
}

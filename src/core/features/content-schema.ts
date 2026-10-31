import {
  type Delivery,
  HOW_TO_APPLY_KINDS,
  KIND_DELIVERY,
  KINDS,
  type Kind,
  kindsRequiring,
  MAX_HOW_TO_APPLY_LENGTH,
} from "../model/kind";
import { MAX_LOCATOR_LENGTH } from "../model/locator";
import { TRIGGER_FIELDS } from "../model/memory";
import { SCOPE_LEVELS } from "../model/scope";

// Tool parameter descriptions are derived from the kind tables, so they cannot drift from the
// validation rules.
const DELIVERY_TEXT: { readonly [D in Delivery]: string } = {
  always: "always shown in full",
  index: "listed in the session index",
  jit: "shown after a matching tool call",
  search: "found by search",
};

const KIND_MEANING: { readonly [K in Kind]: string } = {
  rule: "must hold, binding",
  preference: "how the user likes things done",
  fact: "something true about the project or person",
  decision: "a choice made, with its reason",
  gotcha: "a trap to avoid",
  reference: "a pointer to where something lives",
};

const TRIGGER_LIST = { type: "array", items: { type: "string" } } as const;

function kindsNeeding(requirement: Parameters<typeof kindsRequiring>[0]): string {
  return kindsRequiring(requirement).join(" and ");
}

export const KIND_PROPERTY = {
  type: "string",
  enum: [...KINDS],
  description: KINDS.map(
    (kind) => `${kind}: ${KIND_MEANING[kind]}; ${DELIVERY_TEXT[KIND_DELIVERY[kind]]}`,
  ).join(". "),
} as const;

export const SCOPE_PROPERTY = {
  type: "string",
  enum: [...SCOPE_LEVELS],
  description: "user: about the person, everywhere; org; product: linked repos; repo: this repo",
} as const;

export const CONTENT_PROPERTIES = {
  title: { type: "string", description: "One line" },
  body: {
    type: "string",
    description: "Markdown. Dates as YYYY-MM-DD.",
  },
  locator: {
    type: "string",
    description: `Required for ${kindsNeeding("locator")}, ignored for other kinds: where it points (URL, path, ticket key). One line, at most ${MAX_LOCATOR_LENGTH} characters`,
  },
  why: {
    type: "string",
    description: `Required for ${kindsNeeding("why")}, useful for any kind: the reason it holds, so a later session can judge edge cases`,
  },
  howToApply: {
    type: "string",
    description: `Optional, only for ${HOW_TO_APPLY_KINDS.join(", ")}: when this matters and what to do about it. One line, at most ${MAX_HOW_TO_APPLY_LENGTH} characters`,
  },
  triggers: {
    type: "object",
    description: `Required for ${kindsNeeding("triggers")}. paths: globs of touched files; commands: shell command prefixes; tools: tool names; keywords: single words from the user's message`,
    properties: Object.fromEntries(TRIGGER_FIELDS.map((field) => [field, TRIGGER_LIST])),
  },
} as const;

export const ID_PROPERTY = {
  type: "string",
  description: "Memory id, as shown in brackets",
} as const;

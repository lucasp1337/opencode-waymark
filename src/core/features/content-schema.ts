import { type Delivery, KIND_DELIVERY, KINDS, kindsRequiring } from "../model/kind";
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

const TRIGGER_LIST = { type: "array", items: { type: "string" } } as const;

function kindsNeeding(requirement: Parameters<typeof kindsRequiring>[0]): string {
  return kindsRequiring(requirement).join(" and ");
}

export const KIND_PROPERTY = {
  type: "string",
  enum: [...KINDS],
  description: KINDS.map((kind) => `${kind}: ${DELIVERY_TEXT[KIND_DELIVERY[kind]]}`).join("; "),
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
    description: `Markdown. For ${kindsNeeding("locator")}: include its URL, path or ticket key`,
  },
  why: {
    type: "string",
    description: `Required for ${kindsNeeding("why")}: the reason it holds`,
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

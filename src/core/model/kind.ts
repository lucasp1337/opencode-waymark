export const KINDS = ["rule", "preference", "fact", "decision", "gotcha", "reference"] as const;

export type Kind = (typeof KINDS)[number];

export type Requirement = "why" | "triggers" | "locator";

// The single source of truth for which fields each kind needs.
export const KIND_REQUIREMENTS: { readonly [K in Kind]: readonly Requirement[] } = {
  rule: ["why"],
  preference: [],
  fact: [],
  decision: ["why"],
  gotcha: ["triggers"],
  reference: ["locator"],
};

// Kinds that may say when or where they apply; for the others the field is refused.
export const HOW_TO_APPLY_KINDS: readonly Kind[] = ["rule", "preference", "gotcha"];

export const MAX_HOW_TO_APPLY_LENGTH = 200;

export type Delivery = "always" | "index" | "jit" | "search";

// How each kind reaches the agent.
export const KIND_DELIVERY: { readonly [K in Kind]: Delivery } = {
  rule: "always",
  preference: "always",
  fact: "index",
  decision: "index",
  gotcha: "jit",
  reference: "search",
};

export function kindsRequiring(requirement: Requirement): Kind[] {
  return KINDS.filter((kind) => KIND_REQUIREMENTS[kind].includes(requirement));
}

// Gotchas exist to be recalled after a matching tool call; a fact joins them when it has triggers.
export function isRecalledByTrigger(kind: Kind): boolean {
  return KIND_DELIVERY[kind] === "jit" || kind === "fact";
}

export function isAlwaysOn(kind: Kind): boolean {
  return KIND_DELIVERY[kind] === "always";
}

export function isIndexed(kind: Kind): boolean {
  return KIND_DELIVERY[kind] === "index";
}

export function isKind(value: unknown): value is Kind {
  return KINDS.some((kind) => kind === value);
}

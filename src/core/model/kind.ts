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

export function isKind(value: unknown): value is Kind {
  return KINDS.some((kind) => kind === value);
}

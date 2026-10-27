import type { BudgetCaps } from "../save/budget";

export interface Preset {
  // Token caps per scope for the always-on kinds.
  readonly caps: BudgetCaps;
  // Most index lines (facts and decisions) the session block shows.
  readonly indexLines: number;
}

type PresetName = "lean" | "balanced" | "rich";

// Balanced is the default; Lean halves it and Rich doubles it.
export const PRESETS: { readonly [P in PresetName]: Preset } = {
  lean: { caps: { user: 200, org: 300, product: 150, repo: 300 }, indexLines: 20 },
  balanced: { caps: { user: 400, org: 600, product: 300, repo: 600 }, indexLines: 40 },
  rich: { caps: { user: 800, org: 1200, product: 600, repo: 1200 }, indexLines: 80 },
};

import { describe, expect, test } from "bun:test";
import { PRESETS } from "./presets";

describe("PRESETS", () => {
  test("balanced matches the default caps and index size", () => {
    expect(PRESETS.balanced).toEqual({
      caps: { user: 400, org: 600, product: 300, repo: 600 },
      indexLines: 40,
    });
  });

  test("lean halves and rich doubles balanced", () => {
    const { lean, balanced, rich } = PRESETS;

    expect(lean.indexLines * 2).toBe(balanced.indexLines);
    expect(rich.indexLines).toBe(balanced.indexLines * 2);
    expect(lean.caps.repo * 2).toBe(balanced.caps.repo);
    expect(rich.caps.user).toBe(balanced.caps.user * 2);
  });
});

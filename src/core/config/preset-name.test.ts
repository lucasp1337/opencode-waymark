import { describe, expect, test } from "bun:test";
import { PRESETS } from "../features/recall/presets";
import { DEFAULT_PRESET, PRESET_NAMES } from "./preset-name";

describe("PRESET_NAMES", () => {
  test("lists every preset", () => {
    expect(new Set<string>(PRESET_NAMES)).toEqual(new Set(Object.keys(PRESETS)));
  });

  test("includes the default preset", () => {
    expect(PRESET_NAMES).toContain(DEFAULT_PRESET);
  });
});

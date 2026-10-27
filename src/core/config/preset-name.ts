import { PRESETS } from "../features/recall/presets";

export type PresetName = keyof typeof PRESETS;

export const DEFAULT_PRESET: PresetName = "balanced";

export function isPresetName(value: unknown): value is PresetName {
  return typeof value === "string" && Object.hasOwn(PRESETS, value);
}

export const PRESET_NAMES: readonly PresetName[] = Object.keys(PRESETS).filter(isPresetName);

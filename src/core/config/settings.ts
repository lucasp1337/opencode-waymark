import {
  DEFAULT_LIFECYCLE,
  type IndexExitThresholds,
} from "../features/lifecycle/lifecycle-settings";
import { PRESETS } from "../features/recall/presets";
import type { BudgetCaps } from "../features/save/budget";
import { DEFAULT_PRESET, type PresetName } from "./preset-name";

export interface Settings {
  readonly preset: PresetName;
  readonly caps: BudgetCaps;
  readonly indexLines: number;
  readonly indexExit: IndexExitThresholds;
  readonly subagents: readonly string[];
  readonly compactionSave: boolean;
  readonly toasts: boolean;
}

// What config.jsonc may contain. Absent fields fall back to the preset and the defaults.
export interface ConfigFile {
  readonly preset?: PresetName;
  readonly caps?: Partial<BudgetCaps>;
  readonly indexLines?: number;
  readonly indexExit?: Partial<IndexExitThresholds>;
  readonly subagents?: readonly string[];
  readonly compactionSave?: boolean;
  readonly toasts?: boolean;
}

// Explicit caps and indexLines override what the preset gives.
export function settingsFrom(config: ConfigFile): Settings {
  const preset = config.preset ?? DEFAULT_PRESET;
  const base = PRESETS[preset];
  return {
    preset,
    caps: { ...base.caps, ...config.caps },
    indexLines: config.indexLines ?? base.indexLines,
    indexExit: { ...DEFAULT_LIFECYCLE.indexExit, ...config.indexExit },
    subagents: config.subagents ?? [],
    compactionSave: config.compactionSave ?? true,
    toasts: config.toasts ?? true,
  };
}

function isEmpty(object: object): boolean {
  return Object.keys(object).length === 0;
}

// The patch wins field by field; caps and indexExit merge entry by entry. Switching to another
// preset starts over from it: overrides left from the earlier choice would otherwise outlive the
// switch, and nothing else can remove them.
export function mergeConfig(base: ConfigFile, patch: ConfigFile): ConfigFile {
  const { caps: _caps, indexLines: _indexLines, ...presetFree } = base;
  const switchesPreset =
    patch.preset !== undefined && patch.preset !== (base.preset ?? DEFAULT_PRESET);
  const kept: ConfigFile = switchesPreset ? presetFree : base;
  const caps = { ...kept.caps, ...patch.caps };
  const indexExit = { ...kept.indexExit, ...patch.indexExit };
  return {
    ...kept,
    ...patch,
    ...(isEmpty(caps) ? {} : { caps }),
    ...(isEmpty(indexExit) ? {} : { indexExit }),
  };
}

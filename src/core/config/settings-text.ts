import { PRESETS } from "../features/recall/presets";
import type { BudgetCaps } from "../features/save/budget";
import { SCOPE_LEVELS } from "../model/scope";
import type { PresetName } from "./preset-name";
import type { Settings } from "./settings";

export function presetLabel(name: PresetName): string {
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

function capsText(caps: BudgetCaps): string {
  return SCOPE_LEVELS.map((level) => `${level} ${caps[level]}`).join(", ");
}

export function presetSummary(name: PresetName): string {
  const { caps, indexLines } = PRESETS[name];
  return `${presetLabel(name)}: caps in tokens ${capsText(caps)}; ${indexLines} index lines`;
}

function onOff(flag: boolean): string {
  return flag ? "on" : "off";
}

// One line per setting.
export function describeSettings(settings: Settings): string[] {
  const { sessions, days } = settings.indexExit;
  return [
    `preset: ${settings.preset}`,
    `caps in tokens: ${capsText(settings.caps)}`,
    `index lines: ${settings.indexLines}`,
    `index exit: ${sessions} sessions and ${days} days without a read`,
    `subagents: ${settings.subagents.length === 0 ? "none" : settings.subagents.join(", ")}`,
    `compaction save: ${onOff(settings.compactionSave)}`,
    `toasts: ${onOff(settings.toasts)}`,
  ];
}

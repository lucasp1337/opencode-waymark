import { parseConfigValue } from "../../config/config-file";
import type { ConfigStore } from "../../config/config-store";
import { PRESET_NAMES } from "../../config/preset-name";
import { describeSettings, presetSummary } from "../../config/settings-text";
import { ownField } from "../../model/own-field";
import { SCOPE_LEVELS } from "../../model/scope";
import type { JsonSchemaObject, ToolDef } from "../../port";

export interface ConfigToolDeps {
  readonly config: ConfigStore;
}

const COUNT = { type: "number" } as const;

const INPUT_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    preset: {
      type: "string",
      enum: PRESET_NAMES,
      description: `${PRESET_NAMES.map(presetSummary).join("; ")}. Replaces earlier caps and indexLines`,
    },
    caps: {
      type: "object",
      description: "Token cap per scope for rules and preferences; only the scopes given change",
      properties: Object.fromEntries(SCOPE_LEVELS.map((level) => [level, COUNT])),
    },
    indexLines: {
      type: "number",
      description: "Most facts and decisions listed in the session index",
    },
    indexExitSessions: {
      type: "number",
      description:
        "In-scope sessions a fact or decision must go unread before it leaves the index (and indexExitDays must pass too)",
    },
    indexExitDays: {
      type: "number",
      description: "Days a fact or decision must go unread before it leaves the index",
    },
    subagents: {
      type: "array",
      items: { type: "string" },
      description: "Agent names whose subagent sessions get memory too; replaces the list",
    },
    compactionSave: {
      type: "boolean",
      description: "Ask the agent to save memories before context is compacted",
    },
    toasts: { type: "boolean", description: "Show Waymark toasts" },
  },
};

// The tool's flat arguments, laid out like the config file so one check serves both.
function configValue(input: unknown): Record<string, unknown> {
  const sessions = ownField(input, "indexExitSessions");
  const days = ownField(input, "indexExitDays");
  return {
    preset: ownField(input, "preset"),
    caps: ownField(input, "caps"),
    indexLines: ownField(input, "indexLines"),
    indexExit: sessions === undefined && days === undefined ? undefined : { sessions, days },
    subagents: ownField(input, "subagents"),
    compactionSave: ownField(input, "compactionSave"),
    toasts: ownField(input, "toasts"),
  };
}

function notChanged(problems: readonly string[]): string {
  return `Not changed: ${problems.join("; ")}`;
}

function changeSettings(deps: ConfigToolDeps, input: unknown): string {
  const patch = parseConfigValue(configValue(input));
  if (!patch.ok) {
    return notChanged(patch.error);
  }
  if (Object.keys(patch.value).length === 0) {
    return notChanged(["give at least one setting to change"]);
  }
  const updated = deps.config.update(patch.value);
  return updated.ok
    ? ["Settings saved. Now in effect:", ...describeSettings(updated.value)].join("\n")
    : notChanged(updated.error);
}

export function memoryConfigTool(deps: ConfigToolDeps): ToolDef {
  return {
    name: "memory_config",
    description:
      "Change Waymark settings: preset, token caps per scope, index size and exit thresholds, subagents, compaction save, toasts. Only what the user asked for or agreed to, for example raising a cap after a refused save. Pass only the settings to change.",
    inputSchema: INPUT_SCHEMA,
    // Reports a file system error as a rejection, as an async function would; Biome rejects an
    // `async` function without `await`.
    execute: (input) => Promise.resolve().then(() => changeSettings(deps, input)),
  };
}

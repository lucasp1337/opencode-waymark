import { DEFAULT_LIFECYCLE } from "../features/lifecycle/lifecycle-settings";
import { ownField } from "../model/own-field";
import { err, ok, type Result } from "../model/result";
import { SCOPE_LEVELS } from "../model/scope";
import { isAgentNameList } from "./agent-names";
import { parseJsonc } from "./jsonc";
import { isPresetName, PRESET_NAMES } from "./preset-name";
import type { ConfigFile } from "./settings";

type Draft = { -readonly [K in keyof ConfigFile]?: ConfigFile[K] };

// One config key and how its value is read. The key is part of the type, so a parser cannot be
// filed under another key.
interface FieldParser<K extends keyof ConfigFile> {
  readonly key: K;
  // Writes the parsed value into the draft, or returns what is wrong with it.
  read(value: unknown, draft: Draft): string[];
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

// An object whose keys are among `keys` and whose values are positive integers.
function parseCounts(
  path: string,
  value: unknown,
  keys: readonly string[],
): Result<Record<string, number>, string[]> {
  if (!isJsonObject(value)) {
    return err([`${path} must be an object`]);
  }
  const problems = Object.keys(value)
    .filter((key) => !keys.includes(key))
    .map((key) => `${path} has unknown key "${key}"`);
  const counts: [string, number][] = [];
  for (const key of keys) {
    const count = ownField(value, key);
    if (isPositiveInteger(count)) {
      counts.push([key, count]);
    } else if (count !== undefined) {
      problems.push(`${path}.${key} must be a positive integer`);
    }
  }
  return problems.length > 0 ? err(problems) : ok(Object.fromEntries(counts));
}

// An empty object changes nothing, so it is left out.
function countsField<K extends "caps" | "indexExit">(
  key: K,
  keys: readonly string[],
): FieldParser<K> {
  return {
    key,
    read(value, draft) {
      const counts = parseCounts(key, value, keys);
      if (!counts.ok) {
        return counts.error;
      }
      if (Object.keys(counts.value).length > 0) {
        draft[key] = counts.value;
      }
      return [];
    },
  };
}

function booleanField<K extends "compactionSave" | "toasts">(key: K): FieldParser<K> {
  return {
    key,
    read(value, draft) {
      if (typeof value !== "boolean") {
        return [`${key} must be true or false`];
      }
      draft[key] = value;
      return [];
    },
  };
}

const presetField: FieldParser<"preset"> = {
  key: "preset",
  read(value, draft) {
    if (!isPresetName(value)) {
      return [`preset must be one of ${PRESET_NAMES.join(", ")}`];
    }
    draft.preset = value;
    return [];
  },
};

const indexLinesField: FieldParser<"indexLines"> = {
  key: "indexLines",
  read(value, draft) {
    if (!isPositiveInteger(value)) {
      return ["indexLines must be a positive integer"];
    }
    draft.indexLines = value;
    return [];
  },
};

const subagentsField: FieldParser<"subagents"> = {
  key: "subagents",
  read(value, draft) {
    if (!isAgentNameList(value)) {
      return ["subagents must be a list of non-empty agent names"];
    }
    draft.subagents = value;
    return [];
  },
};

const FIELDS: { readonly [K in keyof ConfigFile]-?: FieldParser<K> } = {
  preset: presetField,
  caps: countsField("caps", SCOPE_LEVELS),
  indexLines: indexLinesField,
  indexExit: countsField("indexExit", Object.keys(DEFAULT_LIFECYCLE.indexExit)),
  subagents: subagentsField,
  compactionSave: booleanField("compactionSave"),
  toasts: booleanField("toasts"),
};

// Every problem is reported at once, so one edit can fix them all. Also the single check for
// values that do not come from a file.
export function parseConfigValue(raw: unknown): Result<ConfigFile, string[]> {
  if (!isJsonObject(raw)) {
    return err(["config must be an object"]);
  }
  const problems = Object.keys(raw)
    .filter((key) => !Object.hasOwn(FIELDS, key))
    .map((key) => `unknown key "${key}"`);
  const config: Draft = {};
  for (const field of Object.values(FIELDS)) {
    const value = ownField(raw, field.key);
    if (value !== undefined) {
      problems.push(...field.read(value, config));
    }
  }
  return problems.length > 0 ? err(problems) : ok(config);
}

export function parseConfig(text: string): Result<ConfigFile, string[]> {
  const json = parseJsonc(text);
  return json.ok ? parseConfigValue(json.value) : err([json.error]);
}

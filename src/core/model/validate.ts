import { isKind, KIND_REQUIREMENTS, KINDS, kindsRequiring, type Requirement } from "./kind";
import { type Locator, parseLocator } from "./locator";
import {
  type MemoryContent,
  TRIGGER_FIELDS,
  type TriggerField,
  type Triggers,
  type ValidContent,
} from "./memory";
import { ownField } from "./own-field";
import { err, ok, type Result } from "./result";
import { isWord } from "./words";

export type ContentPatch = Partial<
  Pick<MemoryContent, "title" | "body" | "why" | "triggers" | "locator">
>;

type FieldResult<T> = Result<T, string>;

const LINE_BREAK = /[\r\n]/;
const WHITESPACE = /\s/;

function isRecord(value: unknown): value is object {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseTitle(value: unknown): FieldResult<string> {
  if (typeof value !== "string" || value.trim() === "") {
    return err("title must be a non-empty string");
  }
  return LINE_BREAK.test(value.trim()) ? err("title must be a single line") : ok(value.trim());
}

function parseBody(value: unknown): FieldResult<string> {
  return typeof value === "string" ? ok(value) : err("body must be a string");
}

function parseWhy(value: unknown): FieldResult<string> {
  return typeof value === "string" && value.trim() !== ""
    ? ok(value.trim())
    : err("why must be a non-empty string");
}

// Which entries each trigger list accepts; keywords and tools are matched as single tokens.
const TRIGGER_ENTRY: { readonly [F in TriggerField]: (entry: string) => boolean } = {
  paths: (entry) => !LINE_BREAK.test(entry),
  commands: (entry) => !LINE_BREAK.test(entry),
  tools: (entry) => !WHITESPACE.test(entry),
  keywords: isWord,
};

function isTriggerField(key: string): key is TriggerField {
  return TRIGGER_FIELDS.some((field) => field === key);
}

function parseTriggerList(field: TriggerField, value: unknown): FieldResult<string[]> {
  if (!Array.isArray(value) || value.length === 0) {
    return err(`triggers.${field} must be a non-empty list of strings`);
  }
  const entries = value.map((entry) => (typeof entry === "string" ? entry.trim() : ""));
  const bad = entries.findIndex((entry) => entry === "" || !TRIGGER_ENTRY[field](entry));
  return bad < 0 ? ok(entries) : err(`triggers.${field}[${bad}] is not a valid ${field} entry`);
}

function parseTriggers(value: unknown): FieldResult<Triggers> {
  if (!isRecord(value)) {
    return err("triggers must be an object");
  }
  const keys = Object.keys(value);
  const stray = keys.find((key) => !isTriggerField(key));
  if (stray !== undefined) {
    return err(`triggers.${stray} is not one of ${TRIGGER_FIELDS.join(", ")}`);
  }
  const triggers: Partial<Record<TriggerField, string[]>> = {};
  for (const field of keys.filter(isTriggerField)) {
    const list = parseTriggerList(field, ownField(value, field));
    if (!list.ok) {
      return list;
    }
    triggers[field] = list.value;
  }
  return keys.length > 0 ? ok(triggers) : err(`triggers needs one of ${TRIGGER_FIELDS.join(", ")}`);
}

const REQUIREMENTS: {
  readonly [R in Requirement]: { met(content: MemoryContent): boolean; problem: string };
} = {
  why: { met: (content) => content.why !== undefined, problem: "needs why: the reason it holds" },
  triggers: {
    met: (content) => content.triggers !== undefined,
    problem: `needs triggers (${TRIGGER_FIELDS.join(", ")})`,
  },
  locator: {
    met: (content) => content.locator !== undefined,
    problem: "needs a locator: where it points (URL, path, ticket key)",
  },
};

// Files written before references carried a locator field stay readable; /memory review lists
// them and the next update must supply the locator.
const LEGACY_TOLERATED: readonly Requirement[] = ["locator"];

export function unmetRequirements(content: MemoryContent): Requirement[] {
  return KIND_REQUIREMENTS[content.kind].filter((name) => !REQUIREMENTS[name].met(content));
}

function unmetExcept(content: MemoryContent, tolerated: readonly Requirement[]): Requirement[] {
  return unmetRequirements(content).filter((name) => !tolerated.includes(name));
}

// A locator only means something on the kinds that require one.
function withoutStrayLocator(content: MemoryContent): MemoryContent {
  if (content.locator === undefined || kindsRequiring("locator").includes(content.kind)) {
    return content;
  }
  const { locator: _stray, ...rest } = content;
  return rest;
}

function isValidContent(
  content: MemoryContent,
  tolerated: readonly Requirement[],
): content is ValidContent {
  return unmetExcept(content, tolerated).length === 0;
}

function validated(
  input: MemoryContent,
  tolerated: readonly Requirement[],
): Result<ValidContent, string[]> {
  const content = withoutStrayLocator(input);
  if (isValidContent(content, tolerated)) {
    return ok(content);
  }
  return err(
    unmetExcept(content, tolerated).map((name) => `${content.kind} ${REQUIREMENTS[name].problem}`),
  );
}

function problemsOf(results: Array<FieldResult<unknown> | undefined>): string[] {
  return results.flatMap((result) => (result === undefined || result.ok ? [] : [result.error]));
}

function parsedValue<T>(result: FieldResult<T> | undefined): T | undefined {
  return result?.ok === true ? result.value : undefined;
}

function parseIfPresent<T>(
  input: object,
  field: keyof ContentPatch,
  parse: (value: unknown) => FieldResult<T>,
): FieldResult<T> | undefined {
  const raw = ownField(input, field);
  return raw === undefined ? undefined : parse(raw);
}

interface PatchResults {
  readonly title?: FieldResult<string> | undefined;
  readonly body?: FieldResult<string> | undefined;
  readonly why?: FieldResult<string> | undefined;
  readonly triggers?: FieldResult<Triggers> | undefined;
  readonly locator?: FieldResult<Locator> | undefined;
}

function patchOf(results: PatchResults): ContentPatch {
  const title = parsedValue(results.title);
  const body = parsedValue(results.body);
  const why = parsedValue(results.why);
  const triggers = parsedValue(results.triggers);
  const locator = parsedValue(results.locator);
  return {
    ...(title === undefined ? {} : { title }),
    ...(body === undefined ? {} : { body }),
    ...(why === undefined ? {} : { why }),
    ...(triggers === undefined ? {} : { triggers }),
    ...(locator === undefined ? {} : { locator }),
  };
}

const NOT_AN_OBJECT = "input must be an object";

// Parses whichever content fields are present; absent fields stay absent.
export function parsePatch(input: unknown): Result<ContentPatch, string[]> {
  if (!isRecord(input)) {
    return err([NOT_AN_OBJECT]);
  }
  const results: PatchResults = {
    title: parseIfPresent(input, "title", parseTitle),
    body: parseIfPresent(input, "body", parseBody),
    why: parseIfPresent(input, "why", parseWhy),
    triggers: parseIfPresent(input, "triggers", parseTriggers),
    locator: parseIfPresent(input, "locator", parseLocator),
  };
  const problems = problemsOf(Object.values(results));
  return problems.length > 0 ? err(problems) : ok(patchOf(results));
}

function parseFields(input: unknown): Result<MemoryContent, string[]> {
  if (!isRecord(input)) {
    return err([NOT_AN_OBJECT]);
  }
  const kind = ownField(input, "kind");
  const title = parseTitle(ownField(input, "title"));
  const body = parseBody(ownField(input, "body"));
  const optional = {
    why: parseIfPresent(input, "why", parseWhy),
    triggers: parseIfPresent(input, "triggers", parseTriggers),
    locator: parseIfPresent(input, "locator", parseLocator),
  };
  const problems = [
    ...(isKind(kind) ? [] : [`kind must be one of ${KINDS.join(", ")}`]),
    ...problemsOf([title, body, ...Object.values(optional)]),
  ];
  if (!(isKind(kind) && title.ok && body.ok) || problems.length > 0) {
    return err(problems);
  }
  return ok({ ...patchOf(optional), kind, title: title.value, body: body.value });
}

function parseWith(
  input: unknown,
  tolerated: readonly Requirement[],
): Result<ValidContent, string[]> {
  const fields = parseFields(input);
  return fields.ok ? validated(fields.value, tolerated) : fields;
}

export function parseContent(input: unknown): Result<ValidContent, string[]> {
  return parseWith(input, []);
}

// For files on disk: a reference saved before locators existed still loads.
export function parseStoredContent(input: unknown): Result<ValidContent, string[]> {
  return parseWith(input, LEGACY_TOLERATED);
}

export function applyPatch(
  content: ValidContent,
  patch: ContentPatch,
): Result<ValidContent, string[]> {
  return validated({ ...content, ...patch }, []);
}

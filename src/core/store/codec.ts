import { isMap, parseDocument, stringify } from "yaml";
import { isMemoryId, type MemoryId } from "../model/id";
import type { Memory, ValidContent } from "../model/memory";
import { ownField } from "../model/own-field";
import { err, ok, type Result } from "../model/result";
import { parseScopeKey, type ScopeRef, scopeKey } from "../model/scope";
import { parseStoredContent } from "../model/validate";

type Parsed<T> = Result<T, string>;

const FENCE_MARK = "---";
const FENCE = `${FENCE_MARK}\n`;
const BOM = "\uFEFF";

// Fixed key order keeps files diff-friendly; absent optional fields are omitted, never null.
function frontmatterOf(memory: Memory) {
  return {
    id: memory.id,
    kind: memory.kind,
    scope: scopeKey(memory.scope),
    title: memory.title,
    ...(memory.why === undefined ? {} : { why: memory.why }),
    ...(memory.howToApply === undefined ? {} : { howToApply: memory.howToApply }),
    ...(memory.triggers === undefined ? {} : { triggers: memory.triggers }),
    ...(memory.locator === undefined ? {} : { locator: memory.locator }),
    created: memory.created,
    updated: memory.updated,
    ...(memory.supersedes === undefined ? {} : { supersedes: memory.supersedes }),
  };
}

export function encodeMemory(memory: Memory): string {
  // lineWidth 0: never fold long titles across lines.
  const frontmatter = stringify(frontmatterOf(memory), { lineWidth: 0 });
  return `${FENCE}${frontmatter}${FENCE}${memory.body}`;
}

interface Parts {
  readonly frontmatter: string;
  readonly body: string;
}

// A file is either LF or CRLF throughout its frontmatter; the opening fence says which. The
// closing fence may end the file, which leaves an empty body.
const LINE_ENDINGS = [
  { eol: "\n", closing: /\n---(?:\n|$)/ },
  { eol: "\r\n", closing: /\r\n---(?:\r\n|$)/ },
] as const;

// The body is everything after the first closing fence, byte for byte, so it may contain fences
// and line endings of its own.
function splitFrontmatter(raw: string): Parsed<Parts> {
  const text = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw;
  const style = LINE_ENDINGS.find(({ eol }) => text.startsWith(`${FENCE_MARK}${eol}`));
  if (style === undefined) {
    return err("missing opening --- line");
  }
  // Search from the opening fence's line break so an empty frontmatter still finds its closing fence.
  const rest = text.slice(FENCE_MARK.length);
  const close = style.closing.exec(rest);
  if (close === null) {
    return err("missing closing --- line");
  }
  return ok({
    frontmatter: rest.slice(style.eol.length, close.index + style.eol.length),
    body: rest.slice(close.index + close[0].length),
  });
}

function parseFrontmatter(yamlText: string): Parsed<unknown> {
  const document = parseDocument(yamlText);
  const [firstError] = document.errors;
  if (firstError !== undefined) {
    // The library appends a source excerpt on further lines; the headline carries the position.
    const [headline = firstError.message] = firstError.message.split("\n");
    return err(`invalid YAML: ${headline}`);
  }
  return isMap(document.contents) ? ok(document.toJS()) : err("frontmatter must be a mapping");
}

function parseId(field: string, value: unknown): Parsed<MemoryId> {
  return isMemoryId(value) ? ok(value) : err(`${field} must be a ULID`);
}

function parseSupersedes(value: unknown): Parsed<MemoryId | undefined> {
  return value === undefined ? ok(undefined) : parseId("supersedes", value);
}

function parseScope(value: unknown): Parsed<ScopeRef> {
  return typeof value === "string" ? parseScopeKey(value) : err("scope must be a string");
}

// Exactly what Date#toISOString writes, so timestamps compare and sort as text.
function isIsoTimestamp(value: string): boolean {
  const time = Date.parse(value);
  return !Number.isNaN(time) && new Date(time).toISOString() === value;
}

function parseTimestamp(field: string, value: unknown): Parsed<string> {
  return typeof value === "string" && isIsoTimestamp(value)
    ? ok(value)
    : err(`${field} must be an ISO timestamp`);
}

function problemOf(result: Parsed<unknown>): string[] {
  return result.ok ? [] : [result.error];
}

function contentFrom(frontmatter: unknown, body: string): Parsed<ValidContent> {
  const parsed = parseStoredContent({
    kind: ownField(frontmatter, "kind"),
    title: ownField(frontmatter, "title"),
    why: ownField(frontmatter, "why"),
    howToApply: ownField(frontmatter, "howToApply"),
    triggers: ownField(frontmatter, "triggers"),
    locator: ownField(frontmatter, "locator"),
    body,
  });
  return parsed.ok ? parsed : err(parsed.error.join("; "));
}

function memoryFrom(frontmatter: unknown, body: string): Parsed<Memory> {
  const id = parseId("id", ownField(frontmatter, "id"));
  const scope = parseScope(ownField(frontmatter, "scope"));
  const content = contentFrom(frontmatter, body);
  const created = parseTimestamp("created", ownField(frontmatter, "created"));
  const updated = parseTimestamp("updated", ownField(frontmatter, "updated"));
  const supersedes = parseSupersedes(ownField(frontmatter, "supersedes"));

  if (id.ok && scope.ok && content.ok && created.ok && updated.ok && supersedes.ok) {
    return ok({
      ...content.value,
      id: id.value,
      scope: scope.value,
      created: created.value,
      updated: updated.value,
      ...(supersedes.value === undefined ? {} : { supersedes: supersedes.value }),
    });
  }
  const problems = [id, scope, content, created, updated, supersedes].flatMap(problemOf);
  return err(problems.join("; "));
}

// Parse boundary for memory files: nothing from disk is trusted until it passes here.
// Keys outside the schema, such as hand-added ones, are accepted but not preserved on rewrite.
export function decodeMemory(text: string): Parsed<Memory> {
  const parts = splitFrontmatter(text);
  if (!parts.ok) {
    return parts;
  }
  const frontmatter = parseFrontmatter(parts.value.frontmatter);
  return frontmatter.ok ? memoryFrom(frontmatter.value, parts.value.body) : frontmatter;
}

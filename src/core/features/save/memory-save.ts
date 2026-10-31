import { type Memory, newMemory, type ValidContent } from "../../model/memory";
import { ownField } from "../../model/own-field";
import { err, ok, type Result } from "../../model/result";
import {
  isScopeLevel,
  SCOPE_LEVELS,
  type ScopeChain,
  type ScopeLevel,
  type ScopeRef,
  scopeAt,
  scopeKey,
} from "../../model/scope";
import { parseContent } from "../../model/validate";
import type { JsonSchemaObject, ToolDef } from "../../port";
import { CONTENT_PROPERTIES, KIND_PROPERTY, SCOPE_PROPERTY } from "../content-schema";
import { memoryLine } from "../memory-line";
import type { ToolDeps } from "../tool-deps";
import { persistMemory } from "./persist";
import { parseRelation, type Relation } from "./relation";

const RELATED_LIMIT = 3;

const INPUT_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    kind: KIND_PROPERTY,
    scope: SCOPE_PROPERTY,
    ...CONTENT_PROPERTIES,
    relation: {
      type: "string",
      description:
        'Only after related memories were shown. "updates:<id>": edit that memory in place. "supersedes:<id>": replace it; the old one is kept but no longer active. "new": unrelated to all shown.',
    },
  },
  required: ["kind", "scope", "title", "body"],
};

interface SaveRequest {
  readonly content: ValidContent;
  readonly level: ScopeLevel;
  readonly relation: Relation | undefined;
}

function parseRequest(input: unknown): Result<SaveRequest, string[]> {
  const content = parseContent(input);
  const level = ownField(input, "scope");
  const relation = parseRelation(ownField(input, "relation"));
  if (content.ok && isScopeLevel(level) && relation.ok) {
    return ok({ content: content.value, level, relation: relation.value });
  }
  return err([
    ...(content.ok ? [] : content.error),
    ...(isScopeLevel(level) ? [] : [`scope must be one of ${SCOPE_LEVELS.join(", ")}`]),
    ...(relation.ok ? [] : [relation.error]),
  ]);
}

function relatedMessage(related: readonly Memory[]): string {
  return [
    "Not saved yet: related memories exist. Check them (memory_read), then call memory_save again with relation set to:",
    '- "updates:<id>" to change that memory in place',
    '- "supersedes:<id>" to replace it with this one',
    '- "new" if this one is different',
    "Related:",
    ...related.map((memory) => `- ${memoryLine(memory)}`),
  ].join("\n");
}

function buildMemory(
  deps: ToolDeps,
  request: SaveRequest,
  scope: ScopeRef,
): Result<Memory, string> {
  const { content, relation } = request;
  const now = deps.now();
  if (relation === undefined || relation.type === "new") {
    return ok(newMemory(content, { id: deps.newId(), scope, now }));
  }
  const existing = deps.store.get(relation.id);
  if (existing === undefined) {
    return err(`no memory with id ${relation.id}`);
  }
  if (relation.type === "supersedes") {
    return ok(newMemory(content, { id: deps.newId(), scope, now, supersedes: existing.id }));
  }
  const supersedes = existing.supersedes === undefined ? {} : { supersedes: existing.supersedes };
  const updated = newMemory(content, { id: existing.id, scope, now, ...supersedes });
  return ok({ ...updated, created: existing.created });
}

// Words and, once the local model is loaded, meaning: a paraphrase in another language counts.
async function relatedTo(
  deps: ToolDeps,
  { title, body }: ValidContent,
  scopes: ScopeChain,
): Promise<Memory[]> {
  const found = await deps.retriever.search(
    { text: `${title}\n${body}`, scopes, limit: RELATED_LIMIT },
    { waitForModel: true },
  );
  return found.memories;
}

async function save(deps: ToolDeps, input: unknown, sessionID: string): Promise<string> {
  const request = parseRequest(input);
  if (!request.ok) {
    return `Not saved: ${request.error.join("; ")}`;
  }
  const chain = await deps.scopes.chainFor(sessionID);
  const target = scopeAt(chain, request.value.level);
  if (target === undefined) {
    const available = chain.map(scopeKey).join(", ");
    return `Not saved: this session has no ${request.value.level} scope; it has ${available}.`;
  }
  const related =
    request.value.relation === undefined ? await relatedTo(deps, request.value.content, chain) : [];
  if (related.length > 0) {
    return relatedMessage(related);
  }
  const memory = buildMemory(deps, request.value, target);
  return memory.ok ? persistMemory(deps, memory.value, "saved") : `Not saved: ${memory.error}`;
}

export function memorySaveTool(deps: ToolDeps): ToolDef {
  return {
    name: "memory_save",
    description:
      "Save a memory for future sessions. Include the why. If related memories exist they are returned and nothing is saved; read them, then call again with relation (prefer updating one).",
    inputSchema: INPUT_SCHEMA,
    execute: (input, ctx) => save(deps, input, ctx.sessionID),
  };
}

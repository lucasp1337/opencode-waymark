import { isKind, KINDS, type Kind } from "../../model/kind";
import { ownField } from "../../model/own-field";
import { err, ok, type Result } from "../../model/result";
import { isScopeLevel, SCOPE_LEVELS, type ScopeLevel } from "../../model/scope";
import type { JsonSchemaObject, ToolDef } from "../../port";
import { KIND_PROPERTY, SCOPE_PROPERTY } from "../content-schema";
import { memoryLine } from "../memory-line";
import type { ToolDeps } from "../tool-deps";
import type { SearchResult } from "./retriever";

const HIT_LIMIT = 10;

const INPUT_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    query: { type: "string", description: "What to look for, in any language" },
    kinds: { type: "array", items: KIND_PROPERTY, description: "Only these kinds" },
    scopes: { type: "array", items: SCOPE_PROPERTY, description: "Only these scopes" },
  },
  required: ["query"],
};

interface SearchRequest {
  readonly query: string;
  readonly kinds: readonly Kind[] | undefined;
  readonly levels: readonly ScopeLevel[] | undefined;
}

function parseQuery(input: unknown): Result<string, string> {
  const query = ownField(input, "query");
  return typeof query === "string" && query.trim() !== ""
    ? ok(query.trim())
    : err("query must be a non-empty string");
}

function parseChoices<T extends string>(
  input: unknown,
  field: string,
  choices: { readonly all: readonly T[]; readonly accepts: (value: unknown) => value is T },
): Result<readonly T[] | undefined, string> {
  const value = ownField(input, field);
  if (value === undefined) {
    return ok(undefined);
  }
  if (Array.isArray(value) && value.every(choices.accepts)) {
    // Models often send an empty list for a filter they do not want, so it restricts nothing.
    return ok(value.length === 0 ? undefined : value);
  }
  return err(`${field} must be a list of ${choices.all.join(", ")}`);
}

function parseRequest(input: unknown): Result<SearchRequest, string[]> {
  const query = parseQuery(input);
  const kinds = parseChoices(input, "kinds", { all: KINDS, accepts: isKind });
  const levels = parseChoices(input, "scopes", { all: SCOPE_LEVELS, accepts: isScopeLevel });
  if (query.ok && kinds.ok && levels.ok) {
    return ok({ query: query.value, kinds: kinds.value, levels: levels.value });
  }
  return err([query, kinds, levels].flatMap((result) => (result.ok ? [] : [result.error])));
}

type SearchDeps = Pick<ToolDeps, "scopes" | "retriever">;

function reply({ memories, meaning }: SearchResult): string {
  const hits =
    memories.length === 0
      ? ["No memories match."]
      : memories.map((memory) => `- ${memoryLine(memory)}`);
  const note =
    meaning === "used" ? [] : [`Matched by words only; meaning-based search is ${meaning}.`];
  return [...hits, ...note].join("\n");
}

async function search(deps: SearchDeps, input: unknown, sessionID: string): Promise<string> {
  const request = parseRequest(input);
  if (!request.ok) {
    return `Not searched: ${request.error.join("; ")}`;
  }
  const { query, kinds, levels } = request.value;
  const chain = await deps.scopes.chainFor(sessionID);
  const scopes =
    levels === undefined ? chain : chain.filter((scope) => levels.includes(scope.level));
  return reply(await deps.retriever.search({ text: query, scopes, kinds, limit: HIT_LIMIT }));
}

export function memorySearchTool(deps: SearchDeps): ToolDef {
  return {
    name: "memory_search",
    description:
      "Search saved memories of this session's scopes. Matches words, and meaning across languages once the local model has loaded. Returns the best matches; read one in full with memory_read.",
    inputSchema: INPUT_SCHEMA,
    execute: (input, ctx) => search(deps, input, ctx.sessionID),
  };
}

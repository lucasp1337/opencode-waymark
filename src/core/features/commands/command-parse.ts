import { isMemoryId, type MemoryId } from "../../model/id";
import { err, ok, type Result } from "../../model/result";
import { isScopeLevel, SCOPE_LEVELS, type ScopeLevel } from "../../model/scope";
import type { OrgMerge } from "../../scope/registry";

export type MemoryCommand =
  | { readonly name: "list" }
  | { readonly name: "review" }
  | { readonly name: "move"; readonly id: MemoryId; readonly level: ScopeLevel }
  | { readonly name: "org-merge"; readonly merge: OrgMerge };

const MOVE_USAGE = `/memory move <id> <${SCOPE_LEVELS.join("|")}>`;
const MERGE_USAGE = "/memory org merge <org to keep> <org to merge into it>";

const USAGE = [
  "Subcommands of /memory:",
  "- /memory: list the memories of this session's scopes",
  "- /memory review: memories that need the user's attention",
  `- ${MOVE_USAGE}: move a memory to another scope of this session`,
  `- ${MERGE_USAGE}: merge the second org (host/owner) into the first`,
  "- /memory setup: choose a preset or customize the limits",
].join("\n");

// Listings show ids in brackets, and the agent may pass them on as shown.
function withoutBrackets(word: string | undefined): string | undefined {
  return word?.startsWith("[") && word.endsWith("]") ? word.slice(1, -1) : word;
}

function parseMove(words: readonly string[]): Result<MemoryCommand, string> {
  const [shownId, level, ...extra] = words;
  const id = withoutBrackets(shownId);
  if (isMemoryId(id) && isScopeLevel(level) && extra.length === 0) {
    return ok({ name: "move", id, level });
  }
  return err(`Not moved: expected ${MOVE_USAGE}, with the id shown in brackets.`);
}

function parseOrgMerge(words: readonly string[]): Result<MemoryCommand, string> {
  const [verb, into, from, ...extra] = words;
  if (verb === "merge" && into !== undefined && from !== undefined && extra.length === 0) {
    return ok({ name: "org-merge", merge: { into, from } });
  }
  return err(`Not merged: expected ${MERGE_USAGE}.`);
}

// Only the shape of the arguments is read, never their meaning.
export function parseMemoryCommand(args: string): Result<MemoryCommand, string> {
  const [name, ...words] = args.split(/\s+/).filter((word) => word !== "");
  switch (name) {
    case undefined:
      return ok({ name: "list" });
    case "review":
      return words.length === 0 ? ok({ name: "review" }) : err(USAGE);
    case "move":
      return parseMove(words);
    case "org":
      return parseOrgMerge(words);
    default:
      return err(USAGE);
  }
}

import { activeOnly } from "../../model/memory";
import { ownField } from "../../model/own-field";
import { err, ok, type Result } from "../../model/result";
import type { ScopeChain } from "../../model/scope";
import type { JsonSchemaObject, ToolDef } from "../../port";
import type { ToolDeps } from "../tool-deps";
import { type MemoryCommand, parseMemoryCommand } from "./command-parse";
import { linkSessionRepo, unlinkSessionRepo } from "./link-repo";
import { listChain } from "./list-chain";
import { type MergeDeps, mergeOrgs } from "./merge-orgs";
import { moveMemory } from "./move-memory";
import { type ReviewSignals, reviewReport } from "./review-report";

export interface MemoryCommandDeps extends MergeDeps, Pick<ToolDeps, "scopes"> {
  readonly reviewSignals: (chain: ScopeChain) => ReviewSignals;
}

const INPUT_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    args: {
      type: "string",
      description: "Everything the user typed after /memory, verbatim; empty to list",
    },
  },
};

function parseArgs(input: unknown): Result<string, string> {
  const args = ownField(input, "args");
  if (args === undefined) {
    return ok("");
  }
  return typeof args === "string" ? ok(args) : err("args must be a string");
}

async function runCommand(
  deps: MemoryCommandDeps,
  command: MemoryCommand,
  sessionID: string,
): Promise<string> {
  if (command.name === "org-merge") {
    return await mergeOrgs(deps, command.merge);
  }
  const chain = await deps.scopes.chainFor(sessionID);
  switch (command.name) {
    case "list":
      return listChain(chain, activeOnly(deps.store.inScopes(chain)));
    case "review":
      return reviewReport(deps.store, chain, deps.reviewSignals(chain));
    case "move":
      return await moveMemory(deps, command, chain);
    case "link":
      return linkSessionRepo(deps, chain, command.product);
    case "unlink":
      return unlinkSessionRepo(deps, chain);
  }
}

async function commandReply(
  deps: MemoryCommandDeps,
  input: unknown,
  sessionID: string,
): Promise<string> {
  const args = parseArgs(input);
  if (!args.ok) {
    return `Not run: ${args.error}`;
  }
  const command = parseMemoryCommand(args.value);
  return command.ok ? await runCommand(deps, command.value, sessionID) : command.error;
}

export function memoryCommandTool(deps: MemoryCommandDeps): ToolDef {
  return {
    name: "memory_command",
    description:
      "Runs a /memory subcommand: list the memories of this session's scopes, review, move a memory to another scope, merge two orgs, or link this session's repo to a product and unlink it. Pass the user's arguments exactly as typed. Call only when the user ran /memory.",
    inputSchema: INPUT_SCHEMA,
    execute: (input, ctx) => commandReply(deps, input, ctx.sessionID),
  };
}

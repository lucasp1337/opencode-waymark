import { isAgentNameList } from "./config/agent-names";
import { ownField } from "./model/own-field";

interface WaymarkOptions {
  // Agent names whose subagent sessions still receive recall.
  readonly subagents: readonly string[];
}

export interface ParsedOptions {
  readonly options: WaymarkOptions;
  readonly problems: readonly string[];
}

// Plugin options come from the user's opencode config; a bad value is reported and ignored.
export function parseOptions(raw: unknown): ParsedOptions {
  const subagents = ownField(raw, "subagents");
  if (subagents === undefined) {
    return { options: { subagents: [] }, problems: [] };
  }
  if (isAgentNameList(subagents)) {
    return { options: { subagents }, problems: [] };
  }
  return {
    options: { subagents: [] },
    problems: ['option "subagents" must be a list of agent names; ignored'],
  };
}

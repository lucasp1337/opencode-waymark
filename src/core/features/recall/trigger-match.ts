import { isAbsolute, relative, sep } from "node:path";
import { TRIGGER_FIELDS, type TriggerField, type Triggers } from "../../model/memory";
import { normalWord } from "../../model/words";
import type { ToolCallInfo } from "../../port";

// What one tool call and the user's latest message offer to trigger matching.
export interface CallFacts {
  readonly tool: string;
  readonly paths: readonly string[];
  readonly command?: string;
  readonly words: ReadonlySet<string>;
  // Ids of the repos whose work trees the call touched.
  readonly repos: readonly string[];
}

// Only a path inside the directory gets a relative form; "../x" is not a path a glob can mean.
function pathForms(directory: string, path: string): string[] {
  if (!isAbsolute(path)) {
    return [path];
  }
  const inside = relative(directory, path);
  const leavesDirectory = inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside);
  return leavesDirectory || inside === "" ? [path] : [path, inside];
}

interface CallContext {
  readonly call: ToolCallInfo;
  readonly directory: string;
  readonly words: ReadonlySet<string>;
  readonly repos: readonly string[];
}

export function callFacts({ call, directory, words, repos }: CallContext): CallFacts {
  return {
    tool: call.tool,
    paths: call.touchedPaths.flatMap((path) => pathForms(directory, path)),
    words,
    repos,
    ...(call.command === undefined ? {} : { command: call.command }),
  };
}

// One matcher per trigger field, so a new field cannot be added without saying how it matches.
const MATCHERS: {
  readonly [F in TriggerField]: (entries: readonly string[], facts: CallFacts) => boolean;
} = {
  paths: (globs, facts) =>
    globs.some((glob) => {
      const pattern = new Bun.Glob(glob);
      return facts.paths.some((path) => pattern.match(path));
    }),
  commands: (prefixes, facts) => {
    const command = facts.command?.trimStart();
    return command !== undefined && prefixes.some((prefix) => command.startsWith(prefix));
  },
  tools: (names, facts) => names.includes(facts.tool),
  keywords: (keywords, facts) => keywords.some((keyword) => facts.words.has(normalWord(keyword))),
  repos: (ids, facts) => ids.some((id) => facts.repos.includes(id)),
};

export function matchesTriggers(triggers: Triggers, facts: CallFacts): boolean {
  return TRIGGER_FIELDS.some((field) => {
    const entries = triggers[field];
    return entries !== undefined && MATCHERS[field](entries, facts);
  });
}

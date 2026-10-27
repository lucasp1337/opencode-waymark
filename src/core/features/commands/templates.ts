export interface CommandTemplate {
  readonly name: string;
  readonly description: string;
  readonly template: string;
}

function memoryTemplate(setupText: string): string {
  return [
    "Waymark memory command. Arguments: $ARGUMENTS",
    "",
    'If the first word of the arguments is "setup", do not call memory_command; follow these instructions instead:',
    "",
    setupText,
    "",
    'Otherwise call memory_command once, with args set to exactly the arguments above (an empty string if there are none), and show its result to the user as it is. After "review", go through the listed memories with the user.',
  ].join("\n");
}

const REMEMBER_TEMPLATE = [
  "Save this as a memory: $ARGUMENTS",
  "",
  "Choose its kind and scope as your memory instructions describe: a rule needs a why, a gotcha needs triggers. Then call memory_save.",
  "If memory_save replies with related memories, follow its reply: ask the user which relation fits or choose it yourself.",
].join("\n");

const FORGET_TEMPLATE = [
  "Forget this memory: $ARGUMENTS",
  "",
  "If that is a memory id, call memory_forget with it.",
  "Otherwise call memory_search with it as the query, show the matches to the user, ask which of them to forget, then call memory_forget for each one they choose.",
].join("\n");

// opencode expands `$` followed by a digit, a backtick command after `!` and `@` file references
// inside a template, so neither these templates nor the setup text may contain them. It also
// expands a `!` command or `@path` the user types in the arguments, as it substitutes them first.
export function commandTemplates(setupText: string): readonly CommandTemplate[] {
  return [
    {
      name: "memory",
      description: "List, review and manage Waymark memories, or set Waymark up",
      template: memoryTemplate(setupText),
    },
    {
      name: "remember",
      description: "Save something as a Waymark memory",
      template: REMEMBER_TEMPLATE,
    },
    {
      name: "forget",
      description: "Forget a Waymark memory by id or by search",
      template: FORGET_TEMPLATE,
    },
  ];
}

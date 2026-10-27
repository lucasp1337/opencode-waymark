import { describe, expect, test } from "bun:test";
import type { Triggers } from "../../model/memory";
import { wordsOf } from "../../model/words";
import type { ToolCallInfo } from "../../port";
import { callFacts, matchesTriggers } from "./trigger-match";

const DIRECTORY = "/work/repo";

interface Situation {
  tool?: string;
  paths?: string[];
  command?: string;
  message?: string;
}

function matches(triggers: Triggers, situation: Situation = {}): boolean {
  const call: ToolCallInfo = {
    sessionID: "s1",
    tool: situation.tool ?? "read",
    args: {},
    touchedPaths: situation.paths ?? [],
    appendable: true,
    ...(situation.command === undefined ? {} : { command: situation.command }),
  };
  return matchesTriggers(triggers, callFacts(call, DIRECTORY, wordsOf(situation.message ?? "")));
}

describe("tool triggers", () => {
  test("match the exact tool name", () => {
    expect(matches({ tools: ["bash"] }, { tool: "bash" })).toBe(true);
  });

  test("do not match another tool", () => {
    expect(matches({ tools: ["bash"] }, { tool: "read" })).toBe(false);
  });

  test("do not match a longer tool name that starts the same", () => {
    expect(matches({ tools: ["bash"] }, { tool: "bash_background" })).toBe(false);
  });
});

describe("command triggers", () => {
  test("match a command that starts with the prefix", () => {
    expect(matches({ commands: ["git push"] }, { command: "git push --force origin main" })).toBe(
      true,
    );
  });

  test("ignore whitespace before the command", () => {
    expect(matches({ commands: ["git push"] }, { command: "  \tgit push" })).toBe(true);
  });

  test("do not match a command that only contains the prefix", () => {
    expect(matches({ commands: ["git push"] }, { command: "echo git push" })).toBe(false);
  });

  test("do not match a command that is shorter than the prefix", () => {
    expect(matches({ commands: ["git push"] }, { command: "git pus" })).toBe(false);
  });

  test("do not match a call that has no command", () => {
    expect(matches({ commands: ["git push"] }, { tool: "read" })).toBe(false);
  });
});

describe("path triggers", () => {
  test("match a glob against a path as the tool received it", () => {
    expect(matches({ paths: ["src/db/**"] }, { paths: ["src/db/schema.ts"] })).toBe(true);
  });

  test("do not match a path the glob misses", () => {
    expect(matches({ paths: ["src/db/**"] }, { paths: ["src/ui/button.ts"] })).toBe(false);
  });

  test("match any one of several touched paths", () => {
    expect(matches({ paths: ["*.lock"] }, { paths: ["a.ts", "b.lock"] })).toBe(true);
  });

  test("match a relative glob against an absolute path inside the session directory", () => {
    expect(matches({ paths: ["src/db/**"] }, { paths: [`${DIRECTORY}/src/db/schema.ts`] })).toBe(
      true,
    );
  });

  test("match an absolute glob against an absolute path inside the session directory", () => {
    expect(matches({ paths: [`${DIRECTORY}/src/**`] }, { paths: [`${DIRECTORY}/src/a.ts`] })).toBe(
      true,
    );
  });

  test("match an absolute glob against an absolute path outside the session directory", () => {
    expect(matches({ paths: ["/work/other/**"] }, { paths: ["/work/other/src/a.ts"] })).toBe(true);
  });

  test("do not match a relative glob against an absolute path outside the session directory", () => {
    expect(matches({ paths: ["src/db/**"] }, { paths: ["/work/other/src/db/a.ts"] })).toBe(false);
  });

  test("do not give a path outside the session directory a parent-relative form", () => {
    expect(matches({ paths: ["../**"] }, { paths: ["/work/other/a.ts"] })).toBe(false);
  });

  test("do not treat a sibling directory with the same name prefix as inside", () => {
    expect(matches({ paths: ["src/**"] }, { paths: ["/work/repo-other/src/a.ts"] })).toBe(false);
  });

  test("treat a file whose name starts with dots as inside the session directory", () => {
    expect(matches({ paths: ["..env"] }, { paths: [`${DIRECTORY}/..env`] })).toBe(true);
  });

  test("do not give the session directory itself an empty relative form", () => {
    expect(matches({ paths: ["*"] }, { paths: [DIRECTORY] })).toBe(false);
  });
});

describe("keyword triggers", () => {
  test("match a whole word of the user's message", () => {
    expect(matches({ keywords: ["migration"] }, { message: "run the migration now" })).toBe(true);
  });

  test("match regardless of case", () => {
    expect(matches({ keywords: ["Migration"] }, { message: "RUN THE migration" })).toBe(true);
  });

  test("match a word next to punctuation", () => {
    expect(matches({ keywords: ["migration"] }, { message: "(the migration), please." })).toBe(
      true,
    );
  });

  test("match a word with accents", () => {
    expect(matches({ keywords: ["košice"] }, { message: "Nasadenie v Košice." })).toBe(true);
  });

  test("do not match a keyword that is only part of a longer word", () => {
    expect(matches({ keywords: ["log"] }, { message: "open the catalog and logging" })).toBe(false);
  });

  test("keep hyphens and underscores inside one word", () => {
    expect(matches({ keywords: ["feature-flag"] }, { message: "toggle the feature-flag" })).toBe(
      true,
    );
    expect(matches({ keywords: ["flag"] }, { message: "toggle the feature-flag" })).toBe(false);
    expect(matches({ keywords: ["feature_flag"] }, { message: "toggle feature_flag" })).toBe(true);
  });

  test("match a message whose accents arrived decomposed", () => {
    const decomposed = "Nasadenie v Kos\u030Cice.";

    expect(matches({ keywords: ["košice"] }, { message: decomposed })).toBe(true);
  });

  test("do not match when no user message has been seen", () => {
    expect(matches({ keywords: ["migration"] })).toBe(false);
  });
});

describe("several trigger lists", () => {
  test("match when only one list matches", () => {
    const triggers: Triggers = { tools: ["bash"], keywords: ["migration"] };

    expect(matches(triggers, { tool: "read", message: "the migration" })).toBe(true);
  });

  test("do not match when no list matches", () => {
    const triggers: Triggers = { tools: ["bash"], keywords: ["migration"] };

    expect(matches(triggers, { tool: "read", message: "hello" })).toBe(false);
  });

  test("do not match empty triggers", () => {
    expect(matches({}, { tool: "bash", message: "migration" })).toBe(false);
  });
});

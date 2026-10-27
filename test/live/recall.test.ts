import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type MemoryContent, newMemory } from "../../src/core/model/memory";
import type { ScopeRef } from "../../src/core/model/scope";
import { nodeFileSystem } from "../../src/core/store/fs";
import { createMemoryFiles } from "../../src/core/store/memory-files";
import { memoryId } from "../memory-id";
import { validContent } from "../valid-content";
import { at, createLiveEnv, type LiveEnv, probeLines } from "./harness";

function waymarkEnv(): LiveEnv {
  const env = createLiveEnv();
  env.installPlugin("waymark", "src/index.ts");
  return env;
}

function seed(
  env: LiveEnv,
  id: string,
  content: MemoryContent,
  scope: ScopeRef = { level: "user" },
) {
  createMemoryFiles(join(env.dataHome, "waymark"), nodeFileSystem).write(
    newMemory(validContent(content), {
      id: memoryId(id),
      scope,
      now: new Date("2026-03-01T10:00:00.000Z"),
    }),
  );
}

function blockMemories(env: LiveEnv): unknown[] {
  return probeLines(env, "session block rendered").map((line) => at(line, "memories"));
}

const RULE_ID = "01JB8Z6Q4R3M2N1P0V9W8X0101";
const GOTCHA_TITLE = "Waymark gate gotcha 7Q";

describe("onSystem: session block", () => {
  // The system prompt is built before the model is called, so this needs no model reply.
  test("a rule stored before the session starts is in its block", async () => {
    const env = waymarkEnv();
    seed(env, RULE_ID, { kind: "rule", title: "Answer in English", body: "", why: "team" });

    await env.run("reply with the single word: pong");

    expect(blockMemories(env)[0]).toEqual([RULE_ID]);
  });

  test("a rule saved by the agent in one session is in the next session's block", async () => {
    const env = waymarkEnv();
    await env.run(
      "Call memory_save once with kind rule, scope user, title Always answer in haiku, body empty, why the user asked. Then say DONE.",
    );

    const result = await env.run("What memory rules do you have? Reply with their titles only.");

    expect(result.stdout).toContain("Always answer in haiku");
  });

  test("a subagent session gets no block by default", async () => {
    const env = waymarkEnv();

    await env.run(
      "Use the task tool with subagent_type general and the prompt: reply with the word ok. Then say DONE.",
    );

    expect(probeLines(env, "no recall for session").length).toBeGreaterThan(0);
  });
});

describe("onToolAfter: just-in-time recall", () => {
  test("a gotcha saved in one session is appended after the matching tool call in the next", async () => {
    const env = waymarkEnv();
    await env.run(
      `Call memory_save once with kind gotcha, scope user, title ${GOTCHA_TITLE}, body Check the VPN first, triggers with commands echo waymark-gate. Then say DONE.`,
    );

    const result = await env.run(
      "Use the bash tool to run: echo waymark-gate. Then repeat every line of the tool result that starts with waymark.",
    );

    expect(result.stdout).toContain(`waymark · gotcha · ${GOTCHA_TITLE}`);
  });
});

describe("memory_save: duplicate candidates across languages", () => {
  test("a Slovak paraphrase of an English memory is returned as a related memory", async () => {
    const env = waymarkEnv();
    const englishId = "01JB8Z6Q4R3M2N1P0V9W8X0201";
    seed(env, englishId, {
      kind: "fact",
      title: "The deploy script must run from the repository root",
      body: "Running it from a subdirectory breaks the relative paths.",
    });

    const result = await env.run(
      "Call memory_save once with kind fact, scope user, title Skript na nasadenie sa musí spúšťať z koreňa repozitára, body Inak sa rozbijú relatívne cesty. Then repeat the tool result exactly.",
    );

    expect(result.stdout).toContain(englishId);
  });
});

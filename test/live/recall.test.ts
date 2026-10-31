import { describe, expect, test } from "bun:test";
import { at, type LiveEnv, liveEnvWithWaymark, probeLines } from "./harness";
import { runScripted, type ScriptedCall } from "./scripted-provider";
import { seedMemory } from "./seed";

function blockMemories(env: LiveEnv): unknown[] {
  return probeLines(env, "session block rendered").map((line) => at(line, "memories"));
}

const RULE_ID = "01JB8Z6Q4R3M2N1P0V9W8X0101";
const GOTCHA_TITLE = "Waymark gate gotcha 7Q";
const RULE_TITLE = "Always answer in haiku";

describe("onSystem: session block", () => {
  // The system prompt is built before the model is called, so this needs no model reply.
  test("a rule stored before the session starts is in its block", async () => {
    const env = liveEnvWithWaymark();
    seedMemory(env, RULE_ID, { kind: "rule", title: "Answer in English", body: "", why: "team" });

    await env.run("reply with the single word: pong");

    expect(blockMemories(env)[0]).toEqual([RULE_ID]);
  });

  test("a rule saved by the agent in one session is in the next session's system prompt", async () => {
    const env = liveEnvWithWaymark();
    await runScripted(env, [
      {
        tool: "memory_save",
        args: { kind: "rule", scope: "user", title: RULE_TITLE, body: "", why: "the user asked" },
      },
    ]);

    const next = await runScripted(env, []);

    expect(next.requestBodies().some((body) => body.includes(RULE_TITLE))).toBe(true);
  });

  test("a subagent session gets no block by default", async () => {
    const env = liveEnvWithWaymark();

    await env.run(
      "Use the task tool with subagent_type general and the prompt: reply with the word ok. Then say DONE.",
    );

    expect(probeLines(env, "no recall for session").length).toBeGreaterThan(0);
  });
});

describe("onToolAfter: just-in-time recall", () => {
  test("a gotcha saved in one session is appended after the matching tool call in the next", async () => {
    const env = liveEnvWithWaymark();
    await runScripted(env, [
      {
        tool: "memory_save",
        args: {
          kind: "gotcha",
          scope: "user",
          title: GOTCHA_TITLE,
          body: "Check the VPN first",
          triggers: { commands: ["echo waymark-gate"] },
        },
      },
    ]);

    const next = await runScripted(env, [
      { tool: "bash", args: { command: "echo waymark-gate", description: "Echo the gate" } },
    ]);

    expect(next.toolResults()).toEqual([
      expect.stringContaining(`waymark · gotcha · ${GOTCHA_TITLE}`),
    ]);
  });
});

// Neither saved text shares a word with the stored memory, so only meaning can relate them.
const STORED_ID = "01JB8Z6Q4R3M2N1P0V9W8X0201";
const stored = {
  kind: "fact",
  title: "Nasadzovací skript sa spúšťa z koreňa repozitára",
  body: "Spustenie z podadresára rozbije relatívne cesty.",
} as const;

function saveFact(title: string, body: string): ScriptedCall {
  return { tool: "memory_save", args: { kind: "fact", scope: "user", title, body } };
}

describe("memory_save: duplicate candidates in one language", () => {
  test("a Slovak paraphrase of a Slovak memory is returned as a related memory", async () => {
    const env = liveEnvWithWaymark();
    seedMemory(env, STORED_ID, stored);

    const provider = await runScripted(env, [
      saveFact(
        "Nasadenie spúšťaj len v hornom adresári repa",
        "V podpriečinku prestanú fungovať odkazy na súbory.",
      ),
    ]);

    expect(provider.toolResults()).toEqual([expect.stringContaining(STORED_ID)]);
  });

  test("an unrelated Slovak note is saved without related memories", async () => {
    const env = liveEnvWithWaymark();
    seedMemory(env, STORED_ID, stored);

    const provider = await runScripted(env, [
      saveFact(
        "Integračné testy potrebujú bežiaci Docker",
        "Pred sadou testov štartuje kontajner Postgresu.",
      ),
    ]);

    expect(provider.toolResults()).toEqual([expect.stringMatching(/^Saved /)]);
  });
});

import { describe, expect, test } from "bun:test";
import { liveEnvWithProbe, liveModelRef, probeLines } from "./harness";
import { SCRIPTED_MODEL_REF, startScriptedProvider } from "./scripted-provider";

describe("onCompaction", () => {
  test("handler runs when a session is compacted and the request succeeds", async () => {
    const env = liveEnvWithProbe();
    const server = await env.serve();
    try {
      const sessionID = await server.newSession();
      await server.prompt(sessionID, "reply with the single word: pong");

      const response = await server.api(`/session/${sessionID}/summarize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(liveModelRef()),
      });

      expect(response.ok).toBe(true);
      expect(probeLines(env, "probe.compaction")).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  test("text returned by the handler is in the summarising model's prompt", async () => {
    const env = liveEnvWithProbe();
    const provider = startScriptedProvider(env, []);
    const server = await env.serve();
    try {
      const sessionID = await server.newSession();
      await server.prompt(sessionID, "reply with the single word: pong", SCRIPTED_MODEL_REF);

      await server.api(`/session/${sessionID}/summarize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(SCRIPTED_MODEL_REF),
      });
    } finally {
      await server.stop();
      provider.stop();
    }

    const prompts = provider.requestBodies();
    expect(prompts.filter((body) => body.includes("WAYMARK_COMPACT_MARKER_4K9"))).toHaveLength(1);
  });
});

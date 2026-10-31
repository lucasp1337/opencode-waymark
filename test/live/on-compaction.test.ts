import { describe, expect, test } from "bun:test";
import { liveEnvWithProbe, liveModelRef, probeLines } from "./harness";

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

  test("text returned by the handler reaches the summarising model", async () => {
    const env = liveEnvWithProbe();
    const server = await env.serve();
    try {
      const sessionID = await server.newSession();
      await server.prompt(sessionID, "reply with the single word: pong");

      await server.api(`/session/${sessionID}/summarize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(liveModelRef()),
      });

      const messages = await (await server.api(`/session/${sessionID}/message`)).text();
      expect(messages).toContain("WAYMARK_COMPACT_MARKER_4K9");
    } finally {
      await server.stop();
    }
  });
});

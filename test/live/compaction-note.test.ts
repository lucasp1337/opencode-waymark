import { describe, expect, test } from "bun:test";
import { LIVE_MODEL, liveEnvWithWaymark } from "./harness";

describe("onCompaction: Waymark's note", () => {
  test("the compaction summary ends with what is not yet saved to memory", async () => {
    const env = liveEnvWithWaymark();
    const server = await env.serve();
    try {
      const sessionID = await server.newSession();
      await server.prompt(sessionID, "Our staging database resets every night at 02:00. Say OK.");

      await server.api(`/session/${sessionID}/summarize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerID: "opencode", modelID: LIVE_MODEL.split("/")[1] }),
      });

      const messages = await (await server.api(`/session/${sessionID}/message`)).text();
      expect(messages).toContain("Not yet saved to memory");
    } finally {
      await server.stop();
    }
  });
});

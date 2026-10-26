import { describe, expect, test } from "bun:test";
import { liveEnvWithProbe, probeLines } from "./harness";

describe("onUserMessage", () => {
  test("handler receives the user's text and the session id", async () => {
    const env = liveEnvWithProbe();

    await env.run("reply with the single word: pong");

    const [message] = probeLines(env, "probe.user");
    expect(message?.text).toBe("reply with the single word: pong");
    expect(String(message?.sessionID)).toStartWith("ses_");
  });
});

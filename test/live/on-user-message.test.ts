import { describe, expect, test } from "bun:test";
import { at, liveEnvWithProbe, probeLines, writeFixture } from "./harness";

describe("onUserMessage", () => {
  test("handler receives the user's text and the session id", async () => {
    const env = liveEnvWithProbe();

    await env.run("reply with the single word: pong");

    const [message] = probeLines(env, "probe.user");
    expect(at(message, "text")).toBe("reply with the single word: pong");
    expect(String(at(message, "sessionID"))).toStartWith("ses_");
  });

  test("text the host adds for an attached file is not part of the user's text", async () => {
    const env = liveEnvWithProbe();
    const file = writeFixture(env.workDir, "notes.txt", "attached body\n");

    await env.run("reply with the single word: pong", ["--file", file, "--"]);

    const [message] = probeLines(env, "probe.user");
    expect(at(message, "text")).toBe("reply with the single word: pong");
  });
});

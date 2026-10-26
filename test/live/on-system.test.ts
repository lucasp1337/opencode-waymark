import { describe, expect, test } from "bun:test";
import { liveEnvWithProbe, probeLines } from "./harness";

describe("onSystem", () => {
  test("text returned by the handler is visible to the agent in its system prompt", async () => {
    const env = liveEnvWithProbe();

    const result = await env.run(
      "What is the project codeword? Reply with only the codeword.",
    );

    expect(result.stdout).toContain("WAYMARK_SYSTEM_MARKER_7Q2");
  });

  test("the hook receives the session id of the request", async () => {
    const env = liveEnvWithProbe();

    await env.run("reply with the single word: pong");

    const ids = probeLines(env, "probe.system").map((line) => String(line.sessionID));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith("ses_"))).toBe(true);
  });

  test("the hook fires on every model request, so callers must cache per session", async () => {
    const env = liveEnvWithProbe();

    await env.run("Call the probe_echo tool once with message hi. Then say DONE.");

    expect(probeLines(env, "probe.system").length).toBeGreaterThanOrEqual(2);
  });
});

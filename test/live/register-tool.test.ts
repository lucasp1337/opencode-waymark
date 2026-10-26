import { describe, expect, test } from "bun:test";
import { liveEnvWithProbe, probeLines } from "./harness";

describe("registerTool", () => {
  test("agent can call a plugin tool built from plain JSON Schema with all supported types", async () => {
    const env = liveEnvWithProbe();

    await env.run(
      "Call the probe_echo tool once with message hello, times 2, mode loud and tags a and b. Then say DONE.",
    );

    const calls = probeLines(env, "probe.tool.execute");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toEqual({ message: "hello", times: 2, mode: "loud", tags: ["a", "b"] });
  });

  test("tool execute context carries the session id and the agent name", async () => {
    const env = liveEnvWithProbe();

    await env.run("Call the probe_echo tool once with message hi. Then say DONE.");

    const ctx = probeLines(env, "probe.tool.execute")[0]?.ctx as Record<string, unknown>;
    expect(String(ctx.sessionID)).toStartWith("ses_");
    expect(ctx.agent).toBe("build");
  });

  test("the string returned by execute reaches the agent as the tool result", async () => {
    const env = liveEnvWithProbe();

    const result = await env.run(
      "Call the probe_echo tool with message zebra and reply with exactly the tool result text and nothing else.",
    );

    expect(result.stdout).toContain('echo:{"message":"zebra"}');
  });
});

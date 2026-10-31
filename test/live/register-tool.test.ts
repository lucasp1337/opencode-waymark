import { describe, expect, test } from "bun:test";
import { at, liveEnvWithProbe, probeLines } from "./harness";
import { runScripted } from "./scripted-provider";

describe("registerTool", () => {
  test("agent can call a plugin tool built from plain JSON Schema with all supported types", async () => {
    const env = liveEnvWithProbe();

    await env.run(
      "Call the probe_echo tool once with message hello, times 2, mode loud and tags a and b. Then say DONE.",
    );

    const calls = probeLines(env, "probe.tool.execute");
    expect(calls).toHaveLength(1);
    expect(at(calls[0], "input")).toEqual({
      message: "hello",
      times: 2,
      mode: "loud",
      tags: ["a", "b"],
    });
  });

  test("tool execute context carries the session id and the agent name", async () => {
    const env = liveEnvWithProbe();

    await env.run("Call the probe_echo tool once with message hi. Then say DONE.");

    const [call] = probeLines(env, "probe.tool.execute");
    expect(String(at(call, "ctx", "sessionID"))).toStartWith("ses_");
    expect(at(call, "ctx", "agent")).toBe("build");
  });

  test("the string returned by execute reaches the agent as the tool result", async () => {
    const env = liveEnvWithProbe();

    const provider = await runScripted(env, [{ tool: "probe_echo", args: { message: "zebra" } }]);

    expect(provider.toolResults()).toEqual([expect.stringContaining('echo:{"message":"zebra"}')]);
  });
});

import { describe, expect, test } from "bun:test";
import { at, liveEnvWithProbe, probeLines } from "./harness";
import { runScripted } from "./scripted-provider";

describe("onSystem", () => {
  test("text returned by the handler is in the system prompt the model receives", async () => {
    const env = liveEnvWithProbe();

    const provider = await runScripted(env, []);

    const system = provider.requestBodies().filter((body) => body.includes('"role":"system"'));
    expect(system.some((body) => body.includes("WAYMARK_SYSTEM_MARKER_7Q2"))).toBe(true);
  });

  test("the hook receives the session id of the request", async () => {
    const env = liveEnvWithProbe();

    await env.run("reply with the single word: pong");

    const ids = probeLines(env, "probe.system").map((line) => String(at(line, "sessionID")));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith("ses_"))).toBe(true);
  });

  test("the hook fires on every model request, so callers must cache per session", async () => {
    const env = liveEnvWithProbe();

    await runScripted(env, [{ tool: "probe_echo", args: { message: "hi" } }]);

    expect(probeLines(env, "probe.system").length).toBeGreaterThanOrEqual(2);
  });
});

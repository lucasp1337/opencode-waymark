import { describe, expect, test } from "bun:test";
import { liveEnvWithProbe, probeLines } from "./harness";

function eventsOf(env: ReturnType<typeof liveEnvWithProbe>): { type: string; sessionID: string }[] {
  return probeLines(env, "probe.session.event").map((line) => {
    const event = line.event as { type: string; sessionID: string };
    return { type: event.type, sessionID: event.sessionID };
  });
}

describe("onSessionEvent", () => {
  test("reports created then idle for one run", async () => {
    const env = liveEnvWithProbe();

    await env.run("reply with the single word: pong");

    const types = eventsOf(env).map((event) => event.type);
    expect(types[0]).toBe("created");
    expect(types).toContain("idle");
  });

  test("reports deleted when a session is removed", async () => {
    const env = liveEnvWithProbe();
    await env.run("reply with the single word: pong");
    const [created] = eventsOf(env);

    await env.run(`Call the probe_delete_other tool with id ${created?.sessionID}. Then say DONE.`);

    expect(eventsOf(env)).toContainEqual({
      type: "deleted",
      sessionID: String(created?.sessionID),
    });
  });
});

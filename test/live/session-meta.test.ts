import { describe, expect, test } from "bun:test";
import { at, liveEnvWithProbe, probeLines } from "./harness";

describe("sessionMeta", () => {
  test("a primary session has no parent and reports its directory", async () => {
    const env = liveEnvWithProbe();

    await env.run("Call the probe_session tool once. Then say DONE.");

    const [line] = probeLines(env, "probe.session.meta");
    expect(at(line, "meta", "parentID")).toBeUndefined();
    expect(at(line, "meta", "id")).toBe(at(line, "ctx", "sessionID") ?? "");
    expect(at(line, "meta", "directory")).toBe(env.workDir);
  });

  test("a subagent session reports the parent session id and its own agent name", async () => {
    const env = liveEnvWithProbe();

    await env.run(
      "Use the task tool with subagent_type general and a prompt telling it to call the probe_session tool once. Then say DONE.",
    );

    const sub = probeLines(env, "probe.session.meta").find(
      (line) => at(line, "meta", "parentID") !== undefined,
    );
    expect(String(at(sub, "meta", "parentID"))).toStartWith("ses_");
    expect(at(sub, "meta", "parentID")).not.toBe(at(sub, "meta", "id"));
    expect(at(sub, "ctx", "agent")).toBe("general");
  });
});

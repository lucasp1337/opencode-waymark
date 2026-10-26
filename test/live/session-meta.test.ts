import { describe, expect, test } from "bun:test";
import { liveEnvWithProbe, probeLines } from "./harness";

interface MetaLine {
  meta: { id: string; parentID?: string; directory: string };
  ctx: { sessionID: string; agent?: string };
}

function metaLines(env: ReturnType<typeof liveEnvWithProbe>): MetaLine[] {
  return probeLines(env, "probe.session.meta").map((line) => line as unknown as MetaLine);
}

describe("sessionMeta", () => {
  test("a primary session has no parent and reports its directory", async () => {
    const env = liveEnvWithProbe();

    await env.run("Call the probe_session tool once. Then say DONE.");

    const [line] = metaLines(env);
    expect(line?.meta.parentID).toBeUndefined();
    expect(line?.meta.id).toBe(line?.ctx.sessionID ?? "");
    expect(line?.meta.directory).toBe(env.workDir);
  });

  test("a subagent session reports the parent session id and its own agent name", async () => {
    const env = liveEnvWithProbe();

    await env.run(
      "Use the task tool with subagent_type general and a prompt telling it to call the probe_session tool once. Then say DONE.",
    );

    const sub = metaLines(env).find((line) => line.meta.parentID !== undefined);
    expect(sub?.meta.parentID).toStartWith("ses_");
    expect(sub?.meta.parentID).not.toBe(sub?.meta.id);
    expect(sub?.ctx.agent).toBe("general");
  });
});

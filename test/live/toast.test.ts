import { describe, expect, test } from "bun:test";
import { liveEnvWithProbe, probeLines } from "./harness";

describe("toast", () => {
  test("showToast resolves without error in a headless run", async () => {
    const env = liveEnvWithProbe();

    await env.run("Call the probe_toast tool with message hello. Then say DONE.");

    expect(probeLines(env, "probe.toast.ok")).toHaveLength(1);
    expect(probeLines(env, "probe.toast.failed")).toHaveLength(0);
  });
});

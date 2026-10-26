import { describe, expect, test } from "bun:test";
import { liveEnvWithProbe } from "./harness";

describe("registerCommand", () => {
  test("a command registered through the config hook runs with its template and arguments", async () => {
    const env = liveEnvWithProbe();

    const result = await env.run("waymark-args-7", ["--command", "waymark-probe"]);

    expect(result.stdout).toContain("PROBE_COMMAND_OK waymark-args-7");
  });
});

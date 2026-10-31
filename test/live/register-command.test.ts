import { describe, expect, test } from "bun:test";
import { liveEnvWithProbe } from "./harness";
import { runScripted } from "./scripted-provider";

describe("registerCommand", () => {
  test("a command registered through the config hook runs with its template and arguments", async () => {
    const env = liveEnvWithProbe();

    const provider = await runScripted(env, [], {
      prompt: "waymark-args-7",
      args: ["--command", "waymark-probe"],
    });

    const expanded = "Reply with exactly: PROBE_COMMAND_OK waymark-args-7";
    expect(provider.requestBodies().some((body) => body.includes(expanded))).toBe(true);
  });
});

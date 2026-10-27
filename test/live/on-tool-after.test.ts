import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  at,
  type Json,
  keysOf,
  type LiveEnv,
  liveEnvWithProbe,
  probeLines,
  writeFixture,
} from "./harness";

function afterCalls(env: LiveEnv, tool: string): Array<Json | undefined> {
  return probeLines(env, "probe.tool.after")
    .map((line) => at(line, "call"))
    .filter((call) => at(call, "tool") === tool);
}

const SEEN = "Then list every WAYMARK_PROBE_ marker you saw in tool results.";

interface Case {
  tool: string;
  prompt: (dir: string) => string;
  pathArg?: string;
}

const CASES: Case[] = [
  {
    tool: "read",
    prompt: (d) => `Use the read tool on ${join(d, "a.txt")}. ${SEEN}`,
    pathArg: "filePath",
  },
  {
    tool: "edit",
    prompt: (d) => `Use the edit tool on ${join(d, "a.txt")} to replace alpha with omega. ${SEEN}`,
    pathArg: "filePath",
  },
  {
    tool: "write",
    prompt: (d) => `Use the write tool to create ${join(d, "b.txt")} containing hello. ${SEEN}`,
    pathArg: "filePath",
  },
  { tool: "bash", prompt: () => `Use the bash tool to run: echo marker-check. ${SEEN}` },
  { tool: "grep", prompt: (d) => `Use the grep tool for alpha in ${d}. ${SEEN}`, pathArg: "path" },
  {
    tool: "glob",
    prompt: (d) => `Use the glob tool with pattern *.txt in ${d}. ${SEEN}`,
    pathArg: "path",
  },
  {
    tool: "task",
    prompt: () =>
      `Use the task tool with subagent_type general and prompt: reply with the word ok. ${SEEN}`,
  },
  { tool: "webfetch", prompt: () => `Use the webfetch tool on https://example.com. ${SEEN}` },
  { tool: "probe_echo", prompt: () => `Call the probe_echo tool with message hi. ${SEEN}` },
];

describe("onToolAfter", () => {
  for (const item of CASES) {
    test(`${item.tool}: hook fires with args, and the appended marker reaches the agent`, async () => {
      const env = liveEnvWithProbe();
      writeFixture(env.workDir, "a.txt", "alpha\n");

      const result = await env.run(item.prompt(env.workDir));

      const [call] = afterCalls(env, item.tool);
      expect(call).toBeDefined();
      expect(at(call, "appendable")).toBe(true);
      if (item.pathArg !== undefined) {
        expect(at(call, "touchedPaths")).toEqual(expect.arrayContaining([expect.any(String)]));
        expect(keysOf(at(call, "args"))).toContain(item.pathArg);
      }
      expect(result.stdout).toContain(`WAYMARK_PROBE_${item.tool}`);
    });
  }

  test("bash: the command argument is exposed as the command", async () => {
    const env = liveEnvWithProbe();

    await env.run(`Use the bash tool to run: echo marker-check. ${SEEN}`);

    expect(String(at(afterCalls(env, "bash")[0], "command"))).toStartWith("echo marker-check");
  });

  test("mcp tool: hook fires and the marker reaches the agent", async () => {
    const env = liveEnvWithProbe();
    const server = join(import.meta.dir, "..", "fixtures", "mcp-echo.ts");
    writeFixture(
      env.configDir,
      "opencode.json",
      JSON.stringify({ mcp: { echo: { type: "local", command: ["bun", server] } } }),
    );

    const result = await env.run(`Call the echo_say tool. ${SEEN}`);

    expect(afterCalls(env, "echo_say")).toHaveLength(1);
    expect(result.stdout).toContain("WAYMARK_PROBE_echo_say");
  });
});

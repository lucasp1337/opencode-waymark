import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
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
import {
  PLAIN_REPLY,
  runScripted,
  SCRIPTED_PATCH_MODEL,
  type ScriptedCall,
} from "./scripted-provider";

function afterCalls(env: LiveEnv, tool: string): Array<Json | undefined> {
  return probeLines(env, "probe.tool.after")
    .map((line) => at(line, "call"))
    .filter((call) => at(call, "tool") === tool);
}

async function afterCallFor(
  env: LiveEnv,
  call: ScriptedCall,
  model?: string,
): Promise<Json | undefined> {
  await runScripted(env, [call], model === undefined ? {} : { model });
  return probeLines(env, "probe.tool.after")
    .map((line) => at(line, "call"))
    .find((logged) => at(logged, "tool") === call.tool);
}

interface Case {
  tool: string;
  args: (dir: string) => ScriptedCall["args"];
  pathArg?: string;
}

const CASES: Case[] = [
  { tool: "read", args: (d) => ({ filePath: join(d, "a.txt") }), pathArg: "filePath" },
  {
    tool: "edit",
    args: (d) => ({ filePath: join(d, "a.txt"), oldString: "alpha", newString: "omega" }),
    pathArg: "filePath",
  },
  {
    tool: "write",
    args: (d) => ({ filePath: join(d, "b.txt"), content: "hello\n" }),
    pathArg: "filePath",
  },
  { tool: "bash", args: () => ({ command: "echo marker-check", description: "Echo a marker" }) },
  { tool: "grep", args: (d) => ({ pattern: "alpha", path: d }), pathArg: "path" },
  { tool: "glob", args: (d) => ({ pattern: "*.txt", path: d }), pathArg: "path" },
  {
    tool: "task",
    args: () => ({ description: "Reply ok", prompt: PLAIN_REPLY, subagent_type: "general" }),
  },
  { tool: "webfetch", args: () => ({ url: "https://example.com", format: "text" }) },
  { tool: "probe_echo", args: () => ({ message: "hi" }) },
];

describe("onToolAfter", () => {
  for (const item of CASES) {
    test(`${item.tool}: the hook fires with the call's args and its text is appended to the result`, async () => {
      const env = liveEnvWithProbe();
      writeFixture(env.workDir, "a.txt", "alpha\n");

      const provider = await runScripted(env, [{ tool: item.tool, args: item.args(env.workDir) }]);

      const [call] = afterCalls(env, item.tool);
      expect(call).toBeDefined();
      expect(at(call, "appendable")).toBe(true);
      if (item.pathArg !== undefined) {
        expect(at(call, "touchedPaths")).toEqual(expect.arrayContaining([expect.any(String)]));
        expect(keysOf(at(call, "args"))).toContain(item.pathArg);
      }
      expect(provider.toolResults()).toEqual([
        expect.stringContaining(`WAYMARK_PROBE_${item.tool}`),
      ]);
    });
  }

  test("bash: the command argument is exposed as the command", async () => {
    const env = liveEnvWithProbe();

    await runScripted(env, [
      { tool: "bash", args: { command: "echo marker-check", description: "Echo a marker" } },
    ]);

    expect(at(afterCalls(env, "bash")[0], "command")).toBe("echo marker-check");
  });

  test("mcp tool: the hook fires and its text is appended to the result", async () => {
    const env = liveEnvWithProbe();
    const server = join(import.meta.dir, "..", "fixtures", "mcp-echo.ts");

    const provider = await runScripted(env, [{ tool: "echo_say", args: {} }], {
      config: { mcp: { echo: { type: "local", command: ["bun", server] } } },
    });

    expect(afterCalls(env, "echo_say")).toHaveLength(1);
    expect(provider.toolResults()).toEqual([expect.stringContaining("WAYMARK_PROBE_echo_say")]);
  });

  test("bash: the workdir argument arrives as a string and counts as a touched path", async () => {
    const env = liveEnvWithProbe();
    const workdir = join(env.workDir, "sub");
    mkdirSync(workdir);

    const call = await afterCallFor(env, {
      tool: "bash",
      args: { command: "echo hi", workdir, description: "Echo hi" },
    });

    expect(at(call, "args", "workdir")).toBe(workdir);
    expect(at(call, "command")).toBe("echo hi");
    expect(at(call, "touchedPaths")).toEqual([workdir]);
  });

  test("apply_patch: patchText arrives as a string and its file header counts as a touched path", async () => {
    const env = liveEnvWithProbe();
    const patchText = [
      "*** Begin Patch",
      "*** Add File: hello.txt",
      "+hello",
      "*** End Patch",
    ].join("\n");

    const call = await afterCallFor(
      env,
      { tool: "apply_patch", args: { patchText } },
      SCRIPTED_PATCH_MODEL,
    );

    expect(at(call, "args", "patchText")).toBe(patchText);
    expect(at(call, "touchedPaths")).toEqual(["hello.txt"]);
  });
});

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { at, type Json, type LiveEnv, liveEnvWithWaymark, parseJson } from "./harness";
import { runScripted, type ScriptedCall, type ScriptedProvider } from "./scripted-provider";
import { seedMemory } from "./seed";

const FACT_ID = "01JB8Z6Q4R3M2N1P0V9W8X0301";
const fact = { kind: "fact", title: "Staging resets nightly 4K", body: "At 02:00." } as const;

function waymarkFile(env: LiveEnv, ...path: string[]): string {
  return join(env.dataHome, "waymark", ...path);
}

// The work dir becomes a clone of github.com/acme/api, so its chain is user, org, repo.
function makeRepo(env: LiveEnv): void {
  for (const args of [
    ["init", "-q"],
    ["remote", "add", "origin", "git@github.com:acme/api.git"],
  ]) {
    Bun.spawnSync(["git", ...args], { cwd: env.workDir });
  }
}

async function listedNames(env: LiveEnv, path: string): Promise<Json[]> {
  const server = await env.serve();
  try {
    const response = await server.api(path);
    const body = parseJson(await response.text());
    return Array.isArray(body) ? body : [];
  } finally {
    await server.stop();
  }
}

// The scripted model makes the one tool call the command's template asks for.
function runMemory(env: LiveEnv, args: string, call: ScriptedCall): Promise<ScriptedProvider> {
  return runScripted(env, [call], { prompt: args, args: ["--command", "memory"] });
}

describe("registerCommand: Waymark's commands", () => {
  // Listing asks the server, not the model.
  test("opencode lists /memory, /remember and /forget", async () => {
    const env = liveEnvWithWaymark();

    const names = (await listedNames(env, "/command")).map((command) => at(command, "name"));

    expect(names).toEqual(expect.arrayContaining(["memory", "remember", "forget"]));
  });

  test("opencode lists memory_config and memory_command among its tools", async () => {
    const env = liveEnvWithWaymark();

    const ids = await listedNames(env, "/experimental/tool/ids");

    expect(ids).toEqual(expect.arrayContaining(["memory_config", "memory_command"]));
  });

  test("/memory lists the memories of the session's scopes", async () => {
    const env = liveEnvWithWaymark();
    seedMemory(env, FACT_ID, fact);

    const provider = await runMemory(env, "", { tool: "memory_command", args: { args: "" } });

    expect(provider.toolResults()).toEqual([expect.stringContaining(fact.title)]);
  });

  test("/memory review reports that nothing needs review", async () => {
    const env = liveEnvWithWaymark();
    seedMemory(env, FACT_ID, fact);

    const provider = await runMemory(env, "review", {
      tool: "memory_command",
      args: { args: "review" },
    });

    expect(provider.toolResults()).toEqual([expect.stringContaining("Nothing needs review")]);
  });

  test("/memory move moves a memory to the repo scope", async () => {
    const env = liveEnvWithWaymark();
    makeRepo(env);
    seedMemory(env, FACT_ID, fact);

    const move = `move ${FACT_ID} repo`;
    await runMemory(env, move, { tool: "memory_command", args: { args: move } });

    expect(
      existsSync(waymarkFile(env, "repos", "github.com/acme/api", "fact", `${FACT_ID}.md`)),
    ).toBe(true);
    expect(existsSync(waymarkFile(env, "user", "fact", `${FACT_ID}.md`))).toBe(false);
  });

  test("/memory org merge records the merged org as an alias", async () => {
    const env = liveEnvWithWaymark();
    mkdirSync(waymarkFile(env), { recursive: true });
    writeFileSync(
      waymarkFile(env, "registry.json"),
      JSON.stringify({
        orgs: {
          "github.com/acme": { owner: "acme" },
          "github.com/acme-labs": { owner: "acme-labs" },
        },
      }),
    );

    const merge = "org merge github.com/acme github.com/acme-labs";
    await runMemory(env, merge, { tool: "memory_command", args: { args: merge } });

    const registry = parseJson(readFileSync(waymarkFile(env, "registry.json"), "utf8"));
    expect(at(registry, "aliases", "github.com/acme-labs")).toBe("github.com/acme");
  });

  test("/memory setup with the Lean preset writes the Lean preset", async () => {
    const env = liveEnvWithWaymark();

    await runMemory(env, "setup", { tool: "memory_config", args: { preset: "lean" } });

    expect(readFileSync(waymarkFile(env, "config.jsonc"), "utf8")).toContain('"lean"');
  });

  test("/remember saves the text as a memory", async () => {
    const env = liveEnvWithWaymark();
    const save = {
      tool: "memory_save",
      args: { kind: "preference", scope: "user", title: "Answers without emoji", body: "" },
    };

    const provider = await runScripted(env, [save], {
      prompt: "I prefer answers without emoji",
      args: ["--command", "remember"],
    });

    expect(provider.toolResults()).toEqual([expect.stringMatching(/^Saved /)]);
  });

  test("/forget with an id forgets that memory", async () => {
    const env = liveEnvWithWaymark();
    const file = seedMemory(env, FACT_ID, fact);

    await runScripted(env, [{ tool: "memory_forget", args: { id: FACT_ID } }], {
      prompt: FACT_ID,
      args: ["--command", "forget"],
    });

    expect(existsSync(file)).toBe(false);
  });
});

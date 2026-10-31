import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { at, type Json, type LiveEnv, liveEnvWithWaymark, parseJson, probeLines } from "./harness";
import { runScripted } from "./scripted-provider";
import { seedMemory } from "./seed";

const API = "github.com/acme/api";
const WEB = "github.com/acme/web";
const RULE_ID = "01JB8Z6Q4R3M2N1P0V9W8X0401";
const productRule = {
  kind: "rule",
  title: "Amounts are integer cents 4P",
  body: "Never floats.",
  why: "Rounding errors between api and web.",
} as const;

function waymarkFile(env: LiveEnv, ...path: string[]): string {
  return join(env.dataHome, "waymark", ...path);
}

function makeRepo(dir: string, origin: string): void {
  mkdirSync(dir, { recursive: true });
  for (const args of [
    ["init", "-q"],
    ["remote", "add", "origin", origin],
  ]) {
    Bun.spawnSync(["git", ...args], { cwd: dir });
  }
}

// The work dir is a clone of github.com/acme/api with a clone of github.com/acme/web inside it,
// so the agent reaches the second repo without leaving its project directory.
function twoRepos(env: LiveEnv): void {
  makeRepo(env.workDir, "git@github.com:acme/api.git");
  const web = join(env.workDir, "web");
  makeRepo(web, "git@github.com:acme/web.git");
  writeFileSync(join(web, "a.txt"), "first file of web\n");
  writeFileSync(join(web, "b.txt"), "second file of web\n");
}

function writeRegistry(env: LiveEnv, registry: Json): void {
  mkdirSync(waymarkFile(env), { recursive: true });
  writeFileSync(waymarkFile(env, "registry.json"), JSON.stringify(registry));
}

function readRegistry(env: LiveEnv): Json {
  return parseJson(readFileSync(waymarkFile(env, "registry.json"), "utf8"));
}

async function toolIds(env: LiveEnv): Promise<Json[]> {
  const server = await env.serve();
  try {
    const body = parseJson(await (await server.api("/experimental/tool/ids")).text());
    return Array.isArray(body) ? body : [];
  } finally {
    await server.stop();
  }
}

// The adapter traces every hook; the reads the agent made are its tool.execute.after traces.
function readCalls(env: LiveEnv): number {
  return probeLines(env, "hook").filter(
    (line) => at(line, "hook") === "tool.execute.after" && at(line, "input", "tool") === "read",
  ).length;
}

const READ_BOTH = "Use the read tool on web/a.txt, then on web/b.txt. Then say DONE.";

describe("registerTool: memory_link", () => {
  // Listing asks the server, not the model.
  test("opencode lists memory_link among its tools", async () => {
    const env = liveEnvWithWaymark();

    expect(await toolIds(env)).toEqual(expect.arrayContaining(["memory_link"]));
  });
});

describe("onSystem: product memories", () => {
  // The system prompt is built before the model is called, so this needs no model reply.
  test.each([
    ["api", "git@github.com:acme/api.git"],
    ["web", "git@github.com:acme/web.git"],
  ])("a product rule is in the block of a session in the %s repo", async (_name, origin) => {
    const env = liveEnvWithWaymark();
    makeRepo(env.workDir, origin);
    writeRegistry(env, { products: { payments: { repos: [API, WEB] } } });
    seedMemory(env, RULE_ID, productRule, { level: "product", id: "payments" });

    await env.run("reply with the single word: pong");

    expect(at(probeLines(env, "session block rendered")[0], "memories")).toEqual([RULE_ID]);
  });
});

describe("onToolAfter: the product hint", () => {
  test("reading two files of a second repo gives exactly one hint", async () => {
    const env = liveEnvWithWaymark();
    twoRepos(env);

    await env.run(READ_BOTH);

    expect(probeLines(env, "product hint")).toEqual([
      expect.objectContaining({ repo: API, other: WEB }),
    ]);
  });

  test("memory_link with the hinted repos and a product name links them into that product", async () => {
    const env = liveEnvWithWaymark();
    twoRepos(env);

    const provider = await runScripted(env, [
      { tool: "read", args: { filePath: join(env.workDir, "web", "a.txt") } },
      { tool: "read", args: { filePath: join(env.workDir, "web", "b.txt") } },
      { tool: "memory_link", args: { repos: [API, WEB], product: "payments" } },
    ]);

    expect(provider.toolResults().join("\n")).toContain(`["${API}", "${WEB}"]`);
    expect(at(readRegistry(env), "products", "payments", "repos")).toEqual([API, WEB]);
  });

  test("after the user's no the pair is never hinted again", async () => {
    const env = liveEnvWithWaymark();
    twoRepos(env);
    writeRegistry(env, { declined: [[API, WEB]] });

    await env.run(READ_BOTH);

    expect(readCalls(env)).toBe(2);
    expect(probeLines(env, "hook failed")).toEqual([]);
    expect(probeLines(env, "product hint")).toEqual([]);
  });
});

describe("registerCommand: /memory link and /memory unlink", () => {
  test("/memory link payments links the session's repo", async () => {
    const env = liveEnvWithWaymark();
    makeRepo(env.workDir, "git@github.com:acme/api.git");

    await env.run("link payments", ["--command", "memory"]);

    expect(at(readRegistry(env), "products", "payments", "repos")).toEqual([API]);
  });

  test("/memory unlink takes the repo out and records a No for the repo left", async () => {
    const env = liveEnvWithWaymark();
    makeRepo(env.workDir, "git@github.com:acme/api.git");
    writeRegistry(env, { products: { payments: { repos: [API, WEB] } } });

    await env.run("unlink", ["--command", "memory"]);

    expect(readRegistry(env)).toMatchObject({
      products: { payments: { repos: [WEB] } },
      declined: [[API, WEB]],
    });
  });
});

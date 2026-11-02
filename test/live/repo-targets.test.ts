import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type LiveEnv, liveEnvWithWaymark } from "./harness";
import { runScripted } from "./scripted-provider";
import { seedMemory } from "./seed";

const API = "github.com/acme/api";
const WEB = "github.com/acme/web";
const BOUNDARY_ID = "01JB8Z6Q4R3M2N1P0V9W8X0701";
const BOUNDARY = {
  kind: "decision",
  title: "web owns the cart 7R",
  body: "Other repos only ever get the cart id 7R.",
  why: "Ownership of cart data.",
  triggers: { repos: [WEB] },
} as const;

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
// standing in for a sibling checkout the agent reads.
function productWithSibling(env: LiveEnv): void {
  makeRepo(env.workDir, "git@github.com:acme/api.git");
  const web = join(env.workDir, "web");
  makeRepo(web, "git@github.com:acme/web.git");
  for (const name of ["a.txt", "b.txt", "c.txt"]) {
    writeFileSync(join(web, name), `file ${name} of web\n`);
  }
  mkdirSync(join(env.dataHome, "waymark"), { recursive: true });
  writeFileSync(
    join(env.dataHome, "waymark", "registry.json"),
    JSON.stringify({ products: { payments: { repos: [API, WEB] } } }),
  );
  seedMemory(env, BOUNDARY_ID, BOUNDARY, { level: "product", id: "payments" });
}

describe("onToolAfter: the repos trigger", () => {
  // A repo's origin is looked up off the tool call's path, so the match follows the first read into
  // the sibling: three reads leave room for a slow git.
  test("a product memory aimed at a sibling repo arrives when the agent reads a file there", async () => {
    const env = liveEnvWithWaymark();
    productWithSibling(env);

    const provider = await runScripted(env, [
      { tool: "read", args: { filePath: join(env.workDir, "web", "a.txt") } },
      { tool: "read", args: { filePath: join(env.workDir, "web", "b.txt") } },
      { tool: "read", args: { filePath: join(env.workDir, "web", "c.txt") } },
    ]);

    const delivered = provider.toolResults().filter((text) => text.includes("cart id 7R"));
    expect(delivered).toHaveLength(1);
  });

  test("it does not arrive when the agent only reads files of its own repo", async () => {
    const env = liveEnvWithWaymark();
    productWithSibling(env);
    writeFileSync(join(env.workDir, "own.txt"), "own file\n");

    const provider = await runScripted(env, [
      { tool: "read", args: { filePath: join(env.workDir, "own.txt") } },
      { tool: "read", args: { filePath: join(env.workDir, "own.txt") } },
    ]);

    expect(provider.toolResults().join("\n")).not.toContain("cart id 7R");
  });
});

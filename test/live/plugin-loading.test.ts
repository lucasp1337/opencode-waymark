import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { at, createLiveEnv, keysOf, writeFixture } from "./harness";

const PROBE = resolve(import.meta.dir, "probe-plugin.ts");
const PROMPT = "reply with the single word: pong";

function loadedCount(env: ReturnType<typeof createLiveEnv>): number {
  return env.logLines().filter((line) => line.msg === "hook" && at(line.data, "hook") === "config")
    .length;
}

describe("plugin loading", () => {
  test("loads a default-exported { id, server } module from the global plugin dir", async () => {
    const env = createLiveEnv();
    env.installPlugin("waymark", "src/index.ts");

    const result = await env.run(PROMPT);

    expect(result.exitCode).toBe(0);
    const loaded = env.logLines().find((line) => line.msg === "plugin loaded");
    expect(keysOf(loaded?.data)).toContain("inputKeys");
    expect(at(loaded?.data, "inputKeys")).toEqual([
      "client",
      "project",
      "worktree",
      "directory",
      "experimental_workspace",
      "serverUrl",
      "$",
    ]);
  });

  test("loads a plugin listed under the config plugin key", async () => {
    const env = createLiveEnv();
    writeFixture(env.configDir, "opencode.json", JSON.stringify({ plugin: [`file://${PROBE}`] }));

    await env.run(PROMPT);

    expect(loadedCount(env)).toBeGreaterThan(0);
  });

  test("loads a plugin from the project-local .opencode/plugin dir", async () => {
    const env = createLiveEnv();
    const pluginDir = join(env.workDir, ".opencode", "plugin");
    mkdirSync(pluginDir, { recursive: true });
    symlinkSync(PROBE, join(pluginDir, "local-probe.ts"));

    await env.run(PROMPT);

    expect(loadedCount(env)).toBeGreaterThan(0);
  });

  test("rejects a path plugin whose default export has no id without failing the run", async () => {
    const env = createLiveEnv();
    const marker = join(env.workDir, "no-id-ran");
    writeFileSync(
      join(env.configDir, "plugin", "no-id.ts"),
      `import { writeFileSync } from "node:fs";\nexport default { server: async () => { writeFileSync(${JSON.stringify(marker)}, "ran"); return {}; } };\n`,
    );
    env.installPlugin("waymark-probe", "test/live/probe-plugin.ts");

    const result = await env.run(PROMPT);

    expect(result.exitCode).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(loadedCount(env)).toBeGreaterThan(0);
  });
});

import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createLiveEnv, type LiveEnv, probeLines, waitUntil } from "./harness";

const LOGGER = resolve(import.meta.dir, "..", "..", "src", "logger.ts");

// A copied (not symlinked) plugin file, so the test can rewrite it while opencode runs.
function reloadPluginSource(version: string): string {
  return [
    `import { createFileLogger, logFilePath } from ${JSON.stringify(LOGGER)};`,
    "const server = async () => {",
    "  const logger = createFileLogger(logFilePath(process.env), () => new Date());",
    `  logger.log("info", "reload.activated", { version: ${JSON.stringify(version)} });`,
    "  return {",
    `    dispose: async () => logger.log("info", "reload.disposed", { version: ${JSON.stringify(version)} }),`,
    "  };",
    "};",
    `export default { id: "waymark-reload", server };`,
    "",
  ].join("\n");
}

function versions(env: LiveEnv, msg: string): unknown[] {
  return probeLines(env, msg).map((line) => line.version);
}

// Long enough for a file watcher to notice the edit, if opencode had one.
const WATCH_GRACE_MS = 3_000;

describe("plugin reload", () => {
  test("editing the plugin file while opencode serves neither reloads nor disposes it", async () => {
    const env = createLiveEnv();
    const pluginFile = join(env.configDir, "plugin", "reload.ts");
    writeFileSync(pluginFile, reloadPluginSource("v1"));
    const server = await env.serve();
    try {
      await server.newSession();
      await waitUntil(() => versions(env, "reload.activated").length > 0);

      writeFileSync(pluginFile, reloadPluginSource("v2"));
      await Bun.sleep(WATCH_GRACE_MS);
      await server.newSession();

      expect(versions(env, "reload.activated")).toEqual(["v1"]);
      expect(versions(env, "reload.disposed")).toEqual([]);
    } finally {
      server.stop();
    }
  });

  test("disposing the instance calls dispose and re-activates the cached module, not the edit", async () => {
    const env = createLiveEnv();
    const pluginFile = join(env.configDir, "plugin", "reload.ts");
    writeFileSync(pluginFile, reloadPluginSource("v1"));
    const server = await env.serve();
    try {
      await server.newSession();
      await waitUntil(() => versions(env, "reload.activated").length > 0);
      writeFileSync(pluginFile, reloadPluginSource("v2"));

      await server.api("/instance/dispose", { method: "POST" });
      await waitUntil(() => versions(env, "reload.disposed").length > 0);
      await server.newSession();
      await waitUntil(() => versions(env, "reload.activated").length > 1);

      expect(versions(env, "reload.disposed")).toEqual(["v1"]);
      expect(versions(env, "reload.activated")).toEqual(["v1", "v1"]);
    } finally {
      server.stop();
    }
  });

  test("a restarted opencode process loads the edited plugin", async () => {
    const env = createLiveEnv();
    const pluginFile = join(env.configDir, "plugin", "reload.ts");
    writeFileSync(pluginFile, reloadPluginSource("v1"));
    const first = await env.serve();
    await first.newSession();
    await waitUntil(() => versions(env, "reload.activated").length > 0);
    first.stop();

    writeFileSync(pluginFile, reloadPluginSource("v2"));
    const second = await env.serve();
    try {
      await second.newSession();
      await waitUntil(() => versions(env, "reload.activated").length > 1);

      expect(versions(env, "reload.activated")).toEqual(["v1", "v2"]);
    } finally {
      second.stop();
    }
  });
});

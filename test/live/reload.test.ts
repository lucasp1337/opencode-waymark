import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  at,
  createLiveEnv,
  type Json,
  type LiveEnv,
  probeLines,
  type ServerHandle,
  waitUntil,
} from "./harness";

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

function versions(env: LiveEnv, msg: string): Array<Json | undefined> {
  return probeLines(env, msg).map((line) => at(line, "version"));
}

interface ReloadSetup {
  env: LiveEnv;
  writePlugin(version: string): void;
}

function reloadSetup(): ReloadSetup {
  const env = createLiveEnv();
  const pluginFile = join(env.configDir, "plugin", "reload.ts");
  const writePlugin = (version: string) => writeFileSync(pluginFile, reloadPluginSource(version));
  writePlugin("v1");
  return { env, writePlugin };
}

// Starts opencode, waits until the plugin has activated `count` times in total, runs `body`, stops.
async function withActivatedServer(
  env: LiveEnv,
  count: number,
  body: (server: ServerHandle) => Promise<void>,
): Promise<void> {
  const server = await env.serve();
  try {
    await server.newSession();
    await waitUntil(() => versions(env, "reload.activated").length >= count);
    await body(server);
  } finally {
    await server.stop();
  }
}

// Long enough for a file watcher to notice the edit, if opencode had one.
const WATCH_GRACE_MS = 3_000;

describe("plugin reload", () => {
  test("editing the plugin file while opencode serves neither reloads nor disposes it", async () => {
    const { env, writePlugin } = reloadSetup();

    // Asserted before the server stops: shutdown itself disposes the instance.
    await withActivatedServer(env, 1, async (server) => {
      writePlugin("v2");
      await Bun.sleep(WATCH_GRACE_MS);
      await server.newSession();

      expect(versions(env, "reload.activated")).toEqual(["v1"]);
      expect(versions(env, "reload.disposed")).toEqual([]);
    });
  });

  test("disposing the instance calls dispose and re-activates the cached module, not the edit", async () => {
    const { env, writePlugin } = reloadSetup();

    await withActivatedServer(env, 1, async (server) => {
      writePlugin("v2");
      const response = await server.api("/instance/dispose", { method: "POST" });
      expect(response.ok).toBe(true);
      await waitUntil(() => versions(env, "reload.disposed").length > 0);
      await server.newSession();
      await waitUntil(() => versions(env, "reload.activated").length > 1);

      expect(versions(env, "reload.disposed")).toEqual(["v1"]);
      expect(versions(env, "reload.activated")).toEqual(["v1", "v1"]);
    });
  });

  test("a restarted opencode process loads the edited plugin", async () => {
    const { env, writePlugin } = reloadSetup();
    await withActivatedServer(env, 1, () => Promise.resolve());

    writePlugin("v2");
    await withActivatedServer(env, 2, () => Promise.resolve());

    expect(versions(env, "reload.activated")).toEqual(["v1", "v2"]);
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeHost } from "../../../../test/fake-host";
import { useTempDirs } from "../../../../test/temp-dir";
import { type ConfigStore, openConfigStore } from "../../config/config-store";
import { nodeFileSystem } from "../../store/fs";
import { memoryConfigTool } from "./memory-config";

const tempDir = useTempDirs();
const SESSION = "ses_1";

function setup() {
  const file = join(tempDir(), "config.jsonc");
  const host = createFakeHost();
  const config: ConfigStore = openConfigStore(nodeFileSystem, file, host.log);
  host.registerTool(memoryConfigTool({ config }));
  const call = (input: unknown) => host.callTool("memory_config", input, SESSION);
  return { file, config, call };
}

describe("memory_config", () => {
  test("applies a preset and answers with the effective settings", async () => {
    const { call, config } = setup();

    const reply = await call({ preset: "rich" });

    expect(config.current().preset).toBe("rich");
    expect(reply).toBe(
      [
        "Settings saved. Now in effect:",
        "preset: rich",
        "caps in tokens: user 800, org 1200, product 600, repo 1200",
        "index lines: 80",
        "index exit: 20 sessions and 30 days without a read",
        "subagents: none",
        "compaction save: on",
        "toasts: on",
      ].join("\n"),
    );
  });

  test("raises the cap of one scope and leaves the others", async () => {
    const { call, config } = setup();

    await call({ caps: { repo: 900 } });

    expect(config.current().caps).toEqual({ user: 400, org: 600, product: 300, repo: 900 });
  });

  test("sets the index size and both index exit thresholds", async () => {
    const { call, config } = setup();

    await call({ indexLines: 25, indexExitSessions: 5, indexExitDays: 10 });

    const settings = config.current();
    expect(settings.indexLines).toBe(25);
    expect(settings.indexExit).toEqual({ sessions: 5, days: 10 });
  });

  test("one index exit threshold keeps the other", async () => {
    const { call, config } = setup();

    await call({ indexExitDays: 10 });

    expect(config.current().indexExit).toEqual({ sessions: 20, days: 10 });
  });

  test("sets subagents, compaction save and toasts", async () => {
    const { call, config } = setup();

    await call({ subagents: ["review"], compactionSave: false, toasts: false });

    const settings = config.current();
    expect(settings.subagents).toEqual(["review"]);
    expect(settings.compactionSave).toBe(false);
    expect(settings.toasts).toBe(false);
  });

  test("an empty list clears the subagents", async () => {
    const { call, config } = setup();
    await call({ subagents: ["review"] });

    await call({ subagents: [] });

    expect(config.current().subagents).toEqual([]);
  });

  test("writes the change to the config file", async () => {
    const { call, file } = setup();

    await call({ toasts: false });

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ toasts: false });
  });

  test("rejects an empty input", async () => {
    const { call, config } = setup();

    expect(await call({})).toBe("Not changed: give at least one setting to change");
    expect(config.exists()).toBe(false);
  });

  test("rejects an input without settings", async () => {
    const { call } = setup();

    expect(await call("rich")).toBe("Not changed: give at least one setting to change");
  });

  test("rejects empty caps as nothing to change", async () => {
    const { call } = setup();

    expect(await call({ caps: {} })).toBe("Not changed: give at least one setting to change");
  });

  test("reports every invalid value and changes nothing", async () => {
    const { call, config } = setup();

    const reply = await call({ preset: "huge", caps: { repo: -1 }, indexExitDays: 0 });

    expect(reply).toBe(
      [
        "Not changed: preset must be one of lean, balanced, rich",
        "caps.repo must be a positive integer",
        "indexExit.days must be a positive integer",
      ].join("; "),
    );
    expect(config.exists()).toBe(false);
  });

  test("rejects an unknown scope in caps", async () => {
    const { call } = setup();

    expect(await call({ caps: { team: 100 } })).toBe('Not changed: caps has unknown key "team"');
  });

  test("reports an invalid config file instead of overwriting it", async () => {
    const { call, file } = setup();
    writeFileSync(file, "not json");

    const reply = await call({ toasts: false });

    expect(reply).toStartWith(`Not changed: ${file} cannot be used, so nothing was changed`);
    expect(readFileSync(file, "utf8")).toBe("not json");
  });

  test("rejects instead of throwing when the config file cannot be written", async () => {
    const host = createFakeHost();
    const failing = {
      ...nodeFileSystem,
      writeAtomic() {
        throw new Error("ENOSPC: no space left on device");
      },
    };
    const config = openConfigStore(failing, join(tempDir(), "config.jsonc"), host.log);
    host.registerTool(memoryConfigTool({ config }));

    const reply = host.callTool("memory_config", { toasts: false }, SESSION);

    await expect(reply).rejects.toThrow("ENOSPC");
  });
});

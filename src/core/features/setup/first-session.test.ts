import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createFakeHost } from "../../../../test/fake-host";
import { useTempDirs } from "../../../../test/temp-dir";
import { openConfigStore } from "../../config/config-store";
import { nodeFileSystem } from "../../store/fs";
import { createFirstSessionNotice } from "./first-session";

const tempDir = useTempDirs();

function setup(capabilities?: Parameters<typeof createFakeHost>[0]) {
  const host = createFakeHost(capabilities);
  const config = openConfigStore(nodeFileSystem, join(tempDir(), "config.jsonc"), host.log);
  return { host, config, notice: createFirstSessionNotice({ host, config }) };
}

describe("first-session notice", () => {
  test("toasts the active preset and how to customize it", async () => {
    const { host, notice } = setup();

    await notice();

    expect(host.toasts).toEqual(["waymark on (Balanced) · /memory setup to customize"]);
  });

  test("toasts only once per activation", async () => {
    const { host, notice } = setup();

    await notice();
    await notice();

    expect(host.toasts).toHaveLength(1);
  });

  test("a new activation toasts again while no config exists", async () => {
    const { host, config } = setup();

    await createFirstSessionNotice({ host, config })();
    await createFirstSessionNotice({ host, config })();

    expect(host.toasts).toHaveLength(2);
  });

  test("says nothing once a config file exists", async () => {
    const { host, config, notice } = setup();
    config.update({ preset: "lean" });

    await notice();

    expect(host.toasts).toEqual([]);
  });

  test("says nothing when the host has no toasts", async () => {
    const { host, notice } = setup({
      systemInjection: true,
      toolOutputMutation: true,
      compactionHook: true,
      toast: false,
    });

    await notice();

    expect(host.toasts).toEqual([]);
  });
});

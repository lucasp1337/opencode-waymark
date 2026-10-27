import { describe, expect, test } from "bun:test";
import { createFakeHost } from "../../test/fake-host";
import { notify } from "./notify";

describe("notify", () => {
  test("shows the message as a toast", async () => {
    const host = createFakeHost();

    await notify(host, "waymark · hi");

    expect(host.toasts).toEqual(["waymark · hi"]);
  });

  test("logs a toast that fails instead of throwing", async () => {
    const host = createFakeHost();
    const failing = { ...host, toast: () => Promise.reject(new Error("no tui")) };

    await notify(failing, "waymark · hi");

    expect(host.logs).toEqual([
      {
        level: "warn",
        msg: "toast failed",
        data: { message: "waymark · hi", error: "Error: no tui" },
      },
    ]);
  });
});

describe("notify without toast support", () => {
  test("skips the toast when the host has none", async () => {
    const host = createFakeHost({
      systemInjection: true,
      toolOutputMutation: true,
      compactionHook: true,
      toast: false,
    });

    await notify(host, "waymark · hi");

    expect(host.toasts).toEqual([]);
    expect(host.logs).toEqual([]);
  });
});

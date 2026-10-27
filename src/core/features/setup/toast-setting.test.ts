import { describe, expect, test } from "bun:test";
import { createFakeHost } from "../../../../test/fake-host";
import { withToastSetting } from "./toast-setting";

describe("withToastSetting", () => {
  test("toasts reach the host while the setting is on", async () => {
    const host = createFakeHost();

    await withToastSetting(host, () => true).toast("waymark · saved rule · user");

    expect(host.toasts).toEqual(["waymark · saved rule · user"]);
  });

  test("toasts are dropped while the setting is off", async () => {
    const host = createFakeHost();

    await withToastSetting(host, () => false).toast("waymark · saved rule · user");

    expect(host.toasts).toEqual([]);
  });

  test("the setting is read for every toast", async () => {
    const host = createFakeHost();
    let enabled = false;
    const quiet = withToastSetting(host, () => enabled);

    await quiet.toast("first");
    enabled = true;
    await quiet.toast("second");

    expect(host.toasts).toEqual(["second"]);
  });

  test("everything but toasts is the host's own", () => {
    const host = createFakeHost();

    const quiet = withToastSetting(host, () => false);

    expect(quiet.capabilities).toBe(host.capabilities);
    expect(quiet.sessionMeta).toBe(host.sessionMeta);
  });
});

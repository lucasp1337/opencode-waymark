import { describe, expect, test } from "bun:test";
import { createFakeHost } from "../../../test/fake-host";
import { guardedTool } from "./guarded-tool";

describe("guardedTool", () => {
  test("passes the tool's own result through", async () => {
    const host = createFakeHost();
    host.registerTool(
      guardedTool(host, {
        name: "ok_tool",
        description: "d",
        inputSchema: { type: "object", properties: {} },
        execute: () => Promise.resolve("fine"),
      }),
    );

    expect(await host.callTool("ok_tool", {}, "ses_1")).toBe("fine");
  });

  test("turns a thrown error into a message and logs it", async () => {
    const host = createFakeHost();
    host.registerTool(
      guardedTool(host, {
        name: "broken_tool",
        description: "d",
        inputSchema: { type: "object", properties: {} },
        execute: () => Promise.reject(new Error("disk on fire")),
      }),
    );

    expect(await host.callTool("broken_tool", {}, "ses_1")).toBe(
      "broken_tool failed inside Waymark (Error: disk on fire); details are in the Waymark log.",
    );
    expect(host.logs).toEqual([
      {
        level: "error",
        msg: "tool failed",
        data: { tool: "broken_tool", error: "Error: disk on fire" },
      },
    ]);
  });
});

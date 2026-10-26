import { describe, expect, test } from "bun:test";
import { createFakeHost } from "./fake-host";

describe("FakeHost", () => {
  test("runs a registered tool with the caller's session", async () => {
    const host = createFakeHost();
    host.registerTool({
      name: "echo",
      description: "echo",
      inputSchema: { type: "object", properties: {} },
      execute: (input, ctx) => Promise.resolve(`${ctx.sessionID}:${JSON.stringify(input)}`),
    });

    expect(await host.callTool("echo", { a: 1 }, "ses_1")).toBe('ses_1:{"a":1}');
  });

  test("rejects an unknown tool", async () => {
    await expect(createFakeHost().callTool("nope", {}, "ses_1")).rejects.toThrow("unknown tool");
  });

  test("collects non-null text from system, tool-after and compaction handlers", async () => {
    const host = createFakeHost();
    host.onSystem(() => Promise.resolve("sys"));
    host.onSystem(() => Promise.resolve(null));
    host.onToolAfter((call) => Promise.resolve(`after:${call.tool}`));
    host.onCompaction(() => Promise.resolve("compact"));

    expect(await host.emitSystem("ses_1")).toEqual(["sys"]);
    expect(
      await host.emitToolAfter({ sessionID: "ses_1", tool: "read", args: {}, touchedPaths: [] }),
    ).toEqual(["after:read"]);
    expect(await host.emitCompaction("ses_1")).toEqual(["compact"]);
  });

  test("delivers user messages and session events to every handler", async () => {
    const host = createFakeHost();
    const seen: string[] = [];
    host.onUserMessage((_id, text) => Promise.resolve(void seen.push(`msg:${text}`)));
    host.onSessionEvent((event) => Promise.resolve(void seen.push(`event:${event.type}`)));

    await host.emitUserMessage("ses_1", "hello");
    await host.emitSessionEvent({ type: "idle", sessionID: "ses_1" });

    expect(seen).toEqual(["msg:hello", "event:idle"]);
  });

  test("records commands, toasts and logs", async () => {
    const host = createFakeHost();

    host.registerCommand("cmd", "desc", "tpl");
    await host.toast("hi");
    host.log("info", "m");
    host.log("warn", "n", { x: 1 });

    expect(host.commands.get("cmd")).toEqual({ description: "desc", template: "tpl" });
    expect(host.toasts).toEqual(["hi"]);
    expect(host.logs).toEqual([
      { level: "info", msg: "m" },
      { level: "warn", msg: "n", data: { x: 1 } },
    ]);
  });

  test("resolves known sessions and rejects unknown ones", async () => {
    const host = createFakeHost();
    host.sessions.set("ses_1", { id: "ses_1", directory: "/repo" });

    expect(await host.sessionMeta("ses_1")).toEqual({ id: "ses_1", directory: "/repo" });
    await expect(host.sessionMeta("ses_2")).rejects.toThrow("unknown session");
  });
});

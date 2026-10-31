import { describe, expect, test } from "bun:test";
import type { LogLevel, SessionEvent, SessionMeta } from "../core/port";
import type { Logger } from "../logger";
import { type AdapterClient, createV1Adapter, type V1Adapter } from "./v1";

type Hooks = ReturnType<V1Adapter["hooks"]>;
type ChatMessage = NonNullable<Hooks["chat.message"]>;
type HookEvent = Parameters<NonNullable<Hooks["event"]>>[0]["event"];

interface Entry {
  level: LogLevel;
  msg: string;
}

function fixture() {
  const entries: Entry[] = [];
  const logger: Logger = { log: (level, msg) => entries.push({ level, msg }) };
  const client: AdapterClient = {
    session: {
      get: ({ path }) =>
        Promise.resolve({ data: { id: path.id, directory: "/repo", parentID: "root" } }),
    },
    tui: { showToast: () => Promise.resolve(undefined) },
  };
  const adapter = createV1Adapter({ client }, logger);
  return { adapter, hooks: adapter.hooks(), entries };
}

function session(id: string) {
  return {
    id,
    projectID: "p",
    directory: "/repo",
    title: "t",
    version: "1",
    time: { created: 0, updated: 0 },
  };
}

function textPart(text: string, flags: { synthetic?: boolean; ignored?: boolean } = {}) {
  return {
    id: "part",
    sessionID: "s1",
    messageID: "m1",
    type: "text" as const,
    text,
    ...flags,
  };
}

function chatOutput(parts: Parameters<ChatMessage>[1]["parts"]): Parameters<ChatMessage>[1] {
  const message = {
    id: "m1",
    sessionID: "s1",
    role: "user" as const,
    time: { created: 0 },
    agent: "build",
    model: { providerID: "p", modelID: "m" },
  };
  return { message, parts };
}

function sendChat(
  hooks: Hooks,
  input: Parameters<ChatMessage>[0],
  parts: Parameters<ChatMessage>[1]["parts"],
): Promise<void> {
  if (hooks["chat.message"] === undefined) {
    throw new Error("chat.message hook missing");
  }
  return hooks["chat.message"](input, chatOutput(parts));
}

async function sendEvent(hooks: Hooks, event: HookEvent): Promise<void> {
  if (hooks.event === undefined) {
    throw new Error("event hook missing");
  }
  await hooks.event({ event });
}

describe("session events", () => {
  test("maps created, deleted and idle events to host session events", async () => {
    const { adapter, hooks } = fixture();
    const seen: SessionEvent[] = [];
    adapter.host.onSessionEvent((e) => {
      seen.push(e);
      return Promise.resolve();
    });

    await sendEvent(hooks, { type: "session.created", properties: { info: session("a") } });
    await sendEvent(hooks, { type: "session.idle", properties: { sessionID: "b" } });
    await sendEvent(hooks, { type: "session.deleted", properties: { info: session("c") } });

    expect(seen).toEqual([
      { type: "created", sessionID: "a" },
      { type: "idle", sessionID: "b" },
      { type: "deleted", sessionID: "c" },
    ]);
  });

  test("ignores events Waymark does not use", async () => {
    const { adapter, hooks } = fixture();
    const seen: SessionEvent[] = [];
    adapter.host.onSessionEvent((e) => {
      seen.push(e);
      return Promise.resolve();
    });

    await sendEvent(hooks, { type: "server.connected", properties: {} });

    expect(seen).toEqual([]);
  });

  test("a throwing handler does not stop the later handlers", async () => {
    const { adapter, hooks, entries } = fixture();
    const seen: SessionEvent[] = [];
    adapter.host.onSessionEvent(() => Promise.reject(new Error("boom")));
    adapter.host.onSessionEvent((e) => {
      seen.push(e);
      return Promise.resolve();
    });

    await sendEvent(hooks, { type: "session.idle", properties: { sessionID: "s1" } });

    expect(seen).toEqual([{ type: "idle", sessionID: "s1" }]);
    expect(entries.filter((e) => e.level === "error")).toHaveLength(1);
  });
});

describe("chat.message", () => {
  test("passes only the text the user typed, joined by newlines", async () => {
    const { adapter, hooks } = fixture();
    const texts: string[] = [];
    adapter.host.onUserMessage((_, text) => {
      texts.push(text);
      return Promise.resolve();
    });

    await sendChat(hooks, { sessionID: "s1" }, [
      textPart("first"),
      textPart("file contents", { synthetic: true }),
      textPart("ignored", { ignored: true }),
      textPart("second"),
    ]);

    expect(texts).toEqual(["first\nsecond"]);
  });

  test("a throwing handler is logged and does not fail the hook", async () => {
    const { adapter, hooks, entries } = fixture();
    adapter.host.onUserMessage(() => Promise.reject(new Error("boom")));

    await sendChat(hooks, { sessionID: "s1" }, [textPart("hi")]);

    expect(entries.filter((e) => e.level === "error")).toHaveLength(1);
  });
});

describe("sessionMeta agent tracking", () => {
  test("reports the agent seen in chat.message", async () => {
    const { adapter, hooks } = fixture();

    await sendChat(hooks, { sessionID: "s1", agent: "plan" }, []);

    const meta: SessionMeta = await adapter.host.sessionMeta("s1");
    expect(meta).toEqual({ id: "s1", directory: "/repo", parentID: "root", agent: "plan" });
  });

  test("forgets the agent when the session is deleted", async () => {
    const { adapter, hooks } = fixture();
    await sendChat(hooks, { sessionID: "s1", agent: "plan" }, []);

    await sendEvent(hooks, { type: "session.deleted", properties: { info: session("s1") } });

    expect((await adapter.host.sessionMeta("s1")).agent).toBeUndefined();
  });
});

describe("guarded hooks", () => {
  test("compaction keeps the other handlers' text when one throws", async () => {
    const { adapter, hooks, entries } = fixture();
    adapter.host.onCompaction(() => Promise.reject(new Error("boom")));
    adapter.host.onCompaction(() => Promise.resolve("note"));
    const output: { context: string[]; prompt?: string } = { context: ["base"] };

    await hooks["experimental.session.compacting"]?.({ sessionID: "s1" }, output);

    expect(output.context).toEqual(["base", "note"]);
    expect(entries.filter((e) => e.level === "error")).toHaveLength(1);
  });

  test("a hook whose own code throws is logged and resolves", async () => {
    const { adapter, hooks, entries } = fixture();
    adapter.host.registerCommand("memory", "d", "t");

    await hooks.config?.(Object.freeze({}));

    expect(entries).toContainEqual({ level: "error", msg: "hook failed" });
  });
});

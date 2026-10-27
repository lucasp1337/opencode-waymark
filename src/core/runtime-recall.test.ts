import { describe, expect, test } from "bun:test";
import { fakeEmbedder } from "../../test/fake-embedder";
import { FIRST_ID, SESSION, useRuntime } from "../../test/runtime-fixture";
import { INSTRUCTIONS } from "./features/recall/instructions";

const runtime = useRuntime();
const withReviewers = useRuntime({ options: { subagents: ["reviewer"] } });

const rule = {
  kind: "rule",
  scope: "repo",
  title: "Run the linter before committing",
  body: "",
  why: "CI rejects lint errors",
};

describe("session block", () => {
  test("a primary session's system prompt starts with the memory instructions", async () => {
    const fx = runtime();

    const [block] = await fx.host.emitSystem(SESSION);

    expect(block).toBe(INSTRUCTIONS);
  });

  test("a rule saved in one session is in the next session's block, not the current one", async () => {
    const fx = runtime();
    await fx.host.emitSystem(SESSION);
    await fx.host.callTool("memory_save", rule, SESSION);
    fx.host.sessions.set("ses_next", { id: "ses_next", directory: "/work/api" });

    const [current] = await fx.host.emitSystem(SESSION);
    const [next] = await fx.host.emitSystem("ses_next");

    expect(current).toBe(INSTRUCTIONS);
    expect(next).toContain("- Run the linter before committing\n  Why: CI rejects lint errors");
  });

  test("a subagent session gets nothing by default", async () => {
    const fx = runtime();
    fx.host.sessions.set("ses_sub", {
      id: "ses_sub",
      parentID: SESSION,
      agent: "general",
      directory: "/work/api",
    });

    expect(await fx.host.emitSystem("ses_sub")).toEqual([]);
  });

  test("a subagent listed in the subagents option gets the block", async () => {
    const fx = withReviewers();
    fx.host.sessions.set("ses_sub", {
      id: "ses_sub",
      parentID: SESSION,
      agent: "reviewer",
      directory: "/work/api",
    });

    expect(await fx.host.emitSystem("ses_sub")).toEqual([INSTRUCTIONS]);
  });
});

const gotcha = {
  kind: "gotcha",
  scope: "repo",
  title: "Deploys need the VPN",
  body: "Connect the VPN first or the upload hangs.",
  triggers: { commands: ["make deploy"] },
};

function bashCall(sessionID: string, appendable = true) {
  return {
    sessionID,
    tool: "bash",
    args: { command: "make deploy" },
    touchedPaths: [],
    command: "make deploy",
    appendable,
  };
}

describe("just-in-time recall", () => {
  test("a gotcha saved earlier is appended after a matching tool call in a later session", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_save", gotcha, SESSION);
    fx.host.sessions.set("ses_next", { id: "ses_next", directory: "/work/api" });

    expect(await fx.host.emitToolAfter(bashCall("ses_next"))).toEqual([
      "waymark · gotcha · Deploys need the VPN\nConnect the VPN first or the upload hangs.",
    ]);
  });

  test("waits for an output it can append to", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_save", gotcha, SESSION);

    expect(await fx.host.emitToolAfter(bashCall(SESSION, false))).toEqual([]);
    expect(await fx.host.emitToolAfter({ ...bashCall(SESSION), command: "ls" })).toHaveLength(1);
  });

  test("a subagent session gets no just-in-time recall", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_save", gotcha, SESSION);
    fx.host.sessions.set("ses_sub", {
      id: "ses_sub",
      parentID: SESSION,
      agent: "general",
      directory: "/work/api",
    });

    expect(await fx.host.emitToolAfter(bashCall("ses_sub"))).toEqual([]);
  });
});

describe("keyword recall", () => {
  test("a gotcha triggered by a word of the user's message is appended to the next tool output", async () => {
    const fx = runtime();
    await fx.host.callTool(
      "memory_save",
      { ...gotcha, title: "Invoices need the tax id", triggers: { keywords: ["invoice"] } },
      SESSION,
    );

    await fx.host.emitUserMessage(SESSION, "Please fix the invoice template");

    expect(await fx.host.emitToolAfter({ ...bashCall(SESSION), command: "ls" })).toHaveLength(1);
  });
});

describe("a deleted session", () => {
  test("starts from nothing when its id is seen again", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_save", gotcha, SESSION);
    await fx.host.emitToolAfter(bashCall(SESSION));

    await fx.host.emitSessionEvent({ type: "deleted", sessionID: SESSION });

    expect(await fx.host.emitToolAfter(bashCall(SESSION))).toHaveLength(1);
  });
});

describe("hosts with fewer capabilities", () => {
  const withoutSystem = useRuntime({
    capabilities: {
      systemInjection: false,
      toolOutputMutation: true,
      compactionHook: true,
      toast: true,
    },
  });
  const withoutToolOutput = useRuntime({
    capabilities: {
      systemInjection: true,
      toolOutputMutation: false,
      compactionHook: true,
      toast: true,
    },
  });

  test("no system prompt injection means no session block", async () => {
    expect(await withoutSystem().host.emitSystem(SESSION)).toEqual([]);
  });

  test("no tool output mutation means no just-in-time recall", async () => {
    const fx = withoutToolOutput();
    await fx.host.callTool("memory_save", gotcha, SESSION);

    expect(await fx.host.emitToolAfter(bashCall(SESSION))).toEqual([]);
  });
});

describe("plugin options", () => {
  const misconfigured = useRuntime({ options: { subagents: "reviewer" } });

  test("a malformed option is logged and ignored", () => {
    const fx = misconfigured();

    expect(fx.host.logs).toContainEqual({
      level: "warn",
      msg: "plugin option ignored",
      data: { problem: 'option "subagents" must be a list of agent names; ignored' },
    });
  });
});

describe("duplicates across languages", () => {
  const withModel = useRuntime({
    embedder: fakeEmbedder([
      [
        "deploy script must run from the repository root",
        "nasadenie sa musí spúšťať z koreňa repozitára",
      ],
    ]),
  });

  test("a Slovak paraphrase of an English memory is returned as a related memory", async () => {
    const fx = withModel();
    const english = {
      kind: "fact",
      scope: "repo",
      title: "The deploy script must run from the repository root",
      body: "Subdirectories break its relative paths.",
    };
    await fx.host.callTool("memory_save", english, SESSION);
    // The first search starts the model load; it is ready from the next one on.
    await fx.host.callTool("memory_search", { query: "warm up" }, SESSION);

    const reply = await fx.host.callTool(
      "memory_save",
      {
        kind: "fact",
        scope: "repo",
        title: "Skript na nasadenie sa musí spúšťať z koreňa repozitára",
        body: "Inak sa rozbijú cesty.",
      },
      SESSION,
    );

    expect(reply).toStartWith("Not saved yet: related memories exist.");
    expect(reply).toContain(`[${FIRST_ID}] fact`);
  });
});

import { describe, expect, test } from "bun:test";
import { fakeEmbedder } from "../../test/fake-embedder";
import { FIRST_ID, SESSION, useRuntime } from "../../test/runtime-fixture";
import { INSTRUCTIONS } from "./features/recall/instructions";
import type { Embedder } from "./store/embedder";

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

    expect(block).toStartWith(INSTRUCTIONS);
  });

  test("a rule saved in one session is in the next session's block, not the current one", async () => {
    const fx = runtime();
    await fx.host.emitSystem(SESSION);
    await fx.host.callTool("memory_save", rule, SESSION);
    fx.host.sessions.set("ses_next", { id: "ses_next", directory: "/work/api" });

    const [current] = await fx.host.emitSystem(SESSION);
    const [next] = await fx.host.emitSystem("ses_next");

    expect(current).toStartWith(INSTRUCTIONS);
    expect(next).toContain(
      "- Run the linter before committing (2026-03-01)\n  Why: CI rejects lint errors",
    );
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

    const [block] = await fx.host.emitSystem("ses_sub");

    expect(block).toStartWith(INSTRUCTIONS);
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
      "waymark · gotcha · Deploys need the VPN (2026-03-01)\nConnect the VPN first or the upload hangs.",
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

describe("memories changed mid-session", () => {
  test("a session's own memory_update is not echoed back, while another session is told", async () => {
    const fx = runtime();
    fx.host.sessions.set("ses_other", { id: "ses_other", directory: "/work/api" });
    await fx.host.emitSystem(SESSION);
    await fx.host.emitSystem("ses_other");
    await fx.host.callTool("memory_save", rule, SESSION);
    await fx.host.callTool(
      "memory_update",
      { id: FIRST_ID, why: "CI fails on lint errors" },
      SESSION,
    );

    const own = await fx.host.emitToolAfter(bashCall(SESSION));
    const other = await fx.host.emitToolAfter(bashCall("ses_other"));

    expect(own).toEqual([]);
    expect(other).toEqual([expect.stringContaining("CI fails on lint errors")]);
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

// Lets every promise reaction queued so far run, without waiting for any time to pass.
function settled(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("a save while the model is still loading", () => {
  const english = {
    kind: "fact",
    scope: "repo",
    title: "The deploy script must run from the repository root",
    body: "Subdirectories break its relative paths.",
  };
  const slovak = {
    kind: "fact",
    scope: "repo",
    title: "Skript na nasadenie sa musí spúšťať z koreňa repozitára",
    body: "Inak sa rozbijú cesty.",
  };
  const model = fakeEmbedder([[english.title, slovak.title]]);
  function slowModel() {
    const loads: PromiseWithResolvers<Embedder>[] = [];
    const timeout = Promise.withResolvers<void>();
    return {
      loads,
      timeout,
      loadEmbedder: () => {
        const load = Promise.withResolvers<Embedder>();
        loads.push(load);
        return load.promise;
      },
      sleep: () => timeout.promise,
    };
  }
  const withSlowModel = useRuntime(slowModel);

  // A second activation over a data dir that already holds the English memory.
  async function restartedWithEnglishSaved() {
    const first = withSlowModel();
    const saving = first.host.callTool("memory_save", english, SESSION);
    await settled();
    first.setup.loads[0]?.resolve(model);
    await saving;
    const fx = first.restart();
    await settled();
    return { fx, loads: first.setup.loads, timeout: first.setup.timeout };
  }

  test("the model starts loading at activation, before any tool or hook runs", async () => {
    const { setup } = withSlowModel();
    await settled();

    expect(setup.loads).toHaveLength(1);
  });

  test("waits for the load and then finds the paraphrase by meaning", async () => {
    const { fx, loads } = await restartedWithEnglishSaved();

    const saving = fx.host.callTool("memory_save", slovak, SESSION);
    loads[1]?.resolve(model);

    expect(await saving).toStartWith("Not saved yet: related memories exist.");
  });

  test("embeds the content only, without the date shown to the agent", async () => {
    const { fx, loads } = await restartedWithEnglishSaved();

    const saving = fx.host.callTool("memory_save", slovak, SESSION);
    loads[1]?.resolve(model);
    await saving;

    const embedded = model.calls.flat();
    expect(embedded).toContain(`${slovak.title}\n${slovak.body}`);
    expect(embedded).toContain(`${english.title}\n${english.body}`);
  });

  test("saves after the bound elapses without a model", async () => {
    const { fx, timeout } = await restartedWithEnglishSaved();

    const saving = fx.host.callTool("memory_save", slovak, SESSION);
    await settled();
    timeout.resolve();

    expect(await saving).toStartWith("Saved");
  });

  test("saves, and logs the failure once, when the model cannot load", async () => {
    const { fx, loads } = await restartedWithEnglishSaved();

    const saving = fx.host.callTool("memory_save", slovak, SESSION);
    loads[1]?.reject(new Error("offline"));
    const reply = await saving;

    expect(reply).toStartWith("Saved");
    expect(
      fx.host.logs.filter((entry) => entry.msg.startsWith("embedding model unavailable")),
    ).toHaveLength(1);
  });
});

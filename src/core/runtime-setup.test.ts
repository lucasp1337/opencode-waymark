import { describe, expect, test } from "bun:test";
import { SESSION, useRuntime } from "../../test/runtime-fixture";
import { INSTRUCTIONS } from "./features/recall/instructions";

const runtime = useRuntime();

function rule(title: string, body: string) {
  return {
    kind: "rule",
    scope: "repo",
    title,
    body,
    why: "The team agreed on it",
    relation: "new",
  };
}

// Balanced gives the repo 600 tokens; this rule alone takes about 510 of them.
const bigRule = rule("Release checklist", "Check the release notes. ".repeat(80));
const nextRule = rule("Pin tool versions", "Pin every build tool to an exact version. ".repeat(10));

const SETUP_TOAST = "waymark on (Balanced) · /memory setup to customize";

describe("cap hit", () => {
  test("a refused save goes through once memory_config raises the cap", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_save", bigRule, SESSION);
    const refused = await fx.host.callTool("memory_save", nextRule, SESSION);

    await fx.host.callTool("memory_config", { caps: { repo: 1200 } }, SESSION);
    const saved = await fx.host.callTool("memory_save", nextRule, SESSION);

    expect(refused).toStartWith("Not saved:");
    expect(saved).toStartWith("Saved [");
  });
});

describe("setup", () => {
  test("the first session's block brings the setup toast, once", async () => {
    const fx = runtime();
    fx.host.sessions.set("ses_next", { id: "ses_next", directory: "/work/api" });

    await fx.host.emitSystem(SESSION);
    await fx.host.emitSystem("ses_next");

    expect(fx.host.toasts.filter((toast) => toast === SETUP_TOAST)).toHaveLength(1);
  });

  test("no setup toast once a config file exists", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_config", { preset: "rich" }, SESSION);

    await fx.host.emitSystem(SESSION);

    expect(fx.host.toasts).toEqual(["waymark · new org: acme"]);
  });

  test("a subagent session without recall brings no setup toast", async () => {
    const fx = runtime();
    fx.host.sessions.set("ses_sub", { id: "ses_sub", directory: "/work/api", parentID: SESSION });

    await fx.host.emitSystem("ses_sub");

    expect(fx.host.toasts).toEqual([]);
  });

  test("toasts turned off in the config silence save toasts", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_config", { toasts: false }, SESSION);

    const saved = await fx.host.callTool("memory_save", bigRule, SESSION);

    expect(saved).toStartWith("Saved [");
    expect(fx.host.toasts).toEqual([]);
  });

  test("a subagent named in the config gets the block", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_config", { subagents: ["reviewer"] }, SESSION);
    fx.host.sessions.set("ses_sub", {
      id: "ses_sub",
      directory: "/work/api",
      parentID: SESSION,
      agent: "reviewer",
    });

    const [block] = await fx.host.emitSystem("ses_sub");

    expect(block).toBe(INSTRUCTIONS);
  });
});

describe("plugin option and setting together", () => {
  const withReviewers = useRuntime({ options: { subagents: ["reviewer"] } });

  test("a subagent named only in the plugin option still gets the block after setup", async () => {
    const fx = withReviewers();
    await fx.host.callTool("memory_config", { subagents: ["planner"] }, SESSION);
    fx.host.sessions.set("ses_sub", {
      id: "ses_sub",
      directory: "/work/api",
      parentID: SESSION,
      agent: "reviewer",
    });

    const [block] = await fx.host.emitSystem("ses_sub");

    expect(block).toBe(INSTRUCTIONS);
  });
});

import { describe, expect, test } from "bun:test";
import { FIRST_ID, type RuntimeFixture, SESSION, useRuntime } from "../../test/runtime-fixture";
import { INSTRUCTIONS } from "./features/recall/instructions";
import { PRESETS } from "./features/recall/presets";
import { DAY_MS } from "./telemetry/telemetry";

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

// A token is four characters; the first rule takes most of Balanced's repo cap, the second the rest
// and more.
const REPO_CAP_CHARS = PRESETS.balanced.caps.repo * 4;
const bigRule = rule("Release checklist", "x".repeat(REPO_CAP_CHARS * 0.8));
const nextRule = rule("Pin tool versions", "y".repeat(REPO_CAP_CHARS * 0.3));

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

const fact = { kind: "fact", scope: "repo", body: "Details.", relation: "new" };

function newSession(fx: RuntimeFixture, id: string): Promise<string[]> {
  fx.host.sessions.set(id, { id, directory: "/work/api" });
  return fx.host.emitSystem(id);
}

describe("index settings", () => {
  test("an index size set with memory_config applies to the next session", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_save", { ...fact, title: "Older fact" }, SESSION);
    fx.clock.advance(DAY_MS);
    await fx.host.callTool("memory_save", { ...fact, title: "Newer fact" }, SESSION);

    await fx.host.callTool("memory_config", { indexLines: 1 }, SESSION);
    const [block = ""] = await newSession(fx, "ses_next");

    expect(block).toContain("Newer fact");
    expect(block).not.toContain("Older fact");
  });

  test("index exit thresholds set with memory_config apply to the next session", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_save", { ...fact, title: "Idle fact" }, SESSION);
    await fx.host.callTool("memory_config", { indexExitSessions: 1, indexExitDays: 1 }, SESSION);
    await newSession(fx, "ses_1");
    fx.clock.advance(DAY_MS);

    const [block = ""] = await newSession(fx, "ses_2");

    expect(block).toStartWith(INSTRUCTIONS);
    expect(block).not.toContain(`[${FIRST_ID}] Idle fact`);
  });
});

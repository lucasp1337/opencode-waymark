import { describe, expect, test } from "bun:test";
import { SESSION, useRuntime } from "../../test/runtime-fixture";
import { INSTRUCTIONS } from "./features/recall/instructions";

const runtime = useRuntime();
const withReviewers = useRuntime({ subagents: ["reviewer"] });

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

describe("plugin options", () => {
  const misconfigured = useRuntime({ subagents: "reviewer" });

  test("a malformed option is logged and ignored", () => {
    const fx = misconfigured();

    expect(fx.host.logs).toContainEqual({
      level: "warn",
      msg: "plugin option ignored",
      data: { problem: 'option "subagents" must be a list of agent names; ignored' },
    });
  });
});

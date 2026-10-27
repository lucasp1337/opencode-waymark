import { describe, expect, test } from "bun:test";
import { createFakeHost } from "../../../../test/fake-host";
import type { ScopeChain } from "../../model/scope";
import type { SessionScopes } from "../../scope/session-scopes";
import { createRecallScopes, receivesRecall } from "./recall-scope";

const CHAIN: ScopeChain = [{ level: "user" }];

function countingScopes(): SessionScopes & { calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    chainFor: () => {
      calls += 1;
      return Promise.resolve(CHAIN);
    },
  };
}

describe("receivesRecall", () => {
  test("a primary session receives recall", () => {
    expect(receivesRecall({ id: "s", directory: "/d" }, [])).toBe(true);
  });

  test("a subagent session receives nothing by default", () => {
    expect(receivesRecall({ id: "s", parentID: "p", agent: "general", directory: "/d" }, [])).toBe(
      false,
    );
  });

  test("a subagent whose agent is listed receives recall", () => {
    expect(
      receivesRecall({ id: "s", parentID: "p", agent: "reviewer", directory: "/d" }, ["reviewer"]),
    ).toBe(true);
  });

  test("a subagent of unknown agent receives nothing", () => {
    expect(receivesRecall({ id: "s", parentID: "p", directory: "/d" }, ["reviewer"])).toBe(false);
  });
});

describe("createRecallScopes", () => {
  test("resolves a primary session's chain and directory once", async () => {
    const host = createFakeHost();
    host.sessions.set("ses_a", { id: "ses_a", directory: "/work/api" });
    const scopes = countingScopes();
    const recall = createRecallScopes({ host, scopes, subagents: [] });

    const first = await recall.recallScope("ses_a");
    await recall.recallScope("ses_a");

    expect(first).toEqual({ chain: CHAIN, directory: "/work/api" });
    expect(scopes.calls()).toBe(1);
  });

  test("a subagent session gets null", async () => {
    const host = createFakeHost();
    host.sessions.set("ses_b", { id: "ses_b", parentID: "ses_a", directory: "/work/api" });

    const recall = createRecallScopes({ host, scopes: countingScopes(), subagents: [] });

    expect(await recall.recallScope("ses_b")).toBeNull();
  });

  test("a failed lookup is retried on the next call", async () => {
    const host = createFakeHost();
    const recall = createRecallScopes({ host, scopes: countingScopes(), subagents: [] });

    await expect(recall.recallScope("ses_late")).rejects.toThrow("unknown session");
    host.sessions.set("ses_late", { id: "ses_late", directory: "/work/api" });

    expect(await recall.recallScope("ses_late")).toEqual({ chain: CHAIN, directory: "/work/api" });
  });
});

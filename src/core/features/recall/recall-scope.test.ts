import { describe, expect, test } from "bun:test";
import { createFakeHost } from "../../../../test/fake-host";
import type { ScopeChain } from "../../model/scope";
import type { SessionScopes } from "../../scope/session-scopes";
import { createRecallScopes, receivesRecall } from "./recall-scope";

const CHAIN: ScopeChain = [{ level: "user" }];
const NO_RECORD = () => Promise.resolve();

function countingScopes(): SessionScopes & { calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    chainFor: () => Promise.resolve(CHAIN),
    resolveSession: () => {
      calls += 1;
      return Promise.resolve({ chain: CHAIN, root: undefined });
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
    const recall = createRecallScopes({
      host,
      scopes,
      recordCheckout: NO_RECORD,
      subagents: () => [],
    });

    const first = await recall.recallScope("ses_a");
    await recall.recallScope("ses_a");

    expect(first).toEqual({ chain: CHAIN, directory: "/work/api" });
    expect(scopes.calls()).toBe(1);
  });

  test("records the session's checkout once, when the session is first seen", async () => {
    const host = createFakeHost();
    host.sessions.set("ses_a", { id: "ses_a", directory: "/work/api/src" });
    const recorded: string[][] = [];
    const chain: ScopeChain = [{ level: "user" }, { level: "repo", id: "x/api" }];
    const scopes: SessionScopes = {
      chainFor: () => Promise.resolve(chain),
      resolveSession: () => Promise.resolve({ chain, root: "/work/api" }),
    };
    const recall = createRecallScopes({
      host,
      scopes,
      recordCheckout: (repo, root) => {
        recorded.push([repo, root]);
        return Promise.resolve();
      },
      subagents: () => [],
    });

    await recall.recallScope("ses_a");
    await recall.recallScope("ses_a");

    expect(recorded).toEqual([["x/api", "/work/api"]]);
  });

  test("records nothing for a session without a repo", async () => {
    const host = createFakeHost();
    host.sessions.set("ses_a", { id: "ses_a", directory: "/tmp" });
    let recorded = 0;
    const recall = createRecallScopes({
      host,
      scopes: countingScopes(),
      recordCheckout: () => {
        recorded += 1;
        return Promise.resolve();
      },
      subagents: () => [],
    });

    await recall.recallScope("ses_a");

    expect(recorded).toBe(0);
  });

  test("a subagent session gets null", async () => {
    const host = createFakeHost();
    host.sessions.set("ses_b", { id: "ses_b", parentID: "ses_a", directory: "/work/api" });

    const recall = createRecallScopes({
      host,
      scopes: countingScopes(),
      recordCheckout: NO_RECORD,
      subagents: () => [],
    });

    expect(await recall.recallScope("ses_b")).toBeNull();
  });

  test("the subagent list is read when a session is first seen", async () => {
    const host = createFakeHost();
    for (const id of ["ses_early", "ses_late"]) {
      host.sessions.set(id, { id, parentID: "ses_a", agent: "reviewer", directory: "/work/api" });
    }
    let subagents: readonly string[] = [];
    const recall = createRecallScopes({
      host,
      scopes: countingScopes(),
      recordCheckout: NO_RECORD,
      subagents: () => subagents,
    });

    await recall.recallScope("ses_early");
    subagents = ["reviewer"];

    expect(await recall.recallScope("ses_early")).toBeNull();
    expect(await recall.recallScope("ses_late")).toEqual({ chain: CHAIN, directory: "/work/api" });
  });

  test("a failed lookup is retried on the next call", async () => {
    const host = createFakeHost();
    const recall = createRecallScopes({
      host,
      scopes: countingScopes(),
      recordCheckout: NO_RECORD,
      subagents: () => [],
    });

    await expect(recall.recallScope("ses_late")).rejects.toThrow("unknown session");
    host.sessions.set("ses_late", { id: "ses_late", directory: "/work/api" });

    expect(await recall.recallScope("ses_late")).toEqual({ chain: CHAIN, directory: "/work/api" });
  });

  test("does not wait for a checkout record held up by the registry lock", async () => {
    const host = createFakeHost();
    host.sessions.set("ses_a", { id: "ses_a", directory: "/work/api" });
    const chain: ScopeChain = [{ level: "user" }, { level: "repo", id: "x/api" }];
    const recall = createRecallScopes({
      host,
      scopes: {
        chainFor: () => Promise.resolve(chain),
        resolveSession: () => Promise.resolve({ chain, root: "/work/api" }),
      },
      recordCheckout: () => new Promise<void>(() => undefined),
      subagents: () => [],
    });

    expect(await recall.recallScope("ses_a")).toEqual({ chain, directory: "/work/api" });
  });
});

import { describe, expect, test } from "bun:test";
import type { ToolCallInfo } from "../../port";
import type { RepoIds } from "./repo-ids";
import { createRepoWatch } from "./repo-watch";

type Lookup = ReturnType<RepoIds["lookup"]>;

function call(sessionID: string, ...paths: string[]): ToolCallInfo {
  return { sessionID, tool: "read", args: {}, touchedPaths: paths, appendable: true };
}

function watchOver(answers: Map<string, Lookup>) {
  const retried = { count: 0 };
  const watch = createRepoWatch({
    repoIds: {
      lookup: (root) => answers.get(root) ?? { status: "pending" },
      retryFailed: () => {
        retried.count += 1;
      },
    },
    touchedRoots: (info) => info.touchedPaths,
  });
  return { watch, retried };
}

describe("createRepoWatch", () => {
  test("reports a root whose repo is known", () => {
    const { watch } = watchOver(new Map([["/w/a", { status: "known", repo: "x/a" }]]));

    expect(watch.observe(call("s", "/w/a"), "/w")).toEqual([{ root: "/w/a", repo: "x/a" }]);
  });

  test("reports a pending root on the next call, even one that touches nothing", () => {
    const answers = new Map<string, Lookup>();
    const { watch } = watchOver(answers);
    expect(watch.observe(call("s", "/w/a"), "/w")).toEqual([]);

    answers.set("/w/a", { status: "known", repo: "x/a" });

    expect(watch.observe(call("s"), "/w")).toEqual([{ root: "/w/a", repo: "x/a" }]);
  });

  test("does not report a resolved root again on a later call", () => {
    const { watch } = watchOver(new Map([["/w/a", { status: "known", repo: "x/a" }]]));
    watch.observe(call("s", "/w/a"), "/w");

    expect(watch.observe(call("s"), "/w")).toEqual([]);
  });

  test("leaves out roots without a repo id and roots whose lookup failed", () => {
    const { watch } = watchOver(
      new Map<string, Lookup>([
        ["/w/a", { status: "known", repo: undefined }],
        ["/w/b", { status: "failed" }],
      ]),
    );

    expect(watch.observe(call("s", "/w/a", "/w/b"), "/w")).toEqual([]);
  });

  test("gives every asker of one call the same answer", () => {
    const { watch } = watchOver(new Map([["/w/a", { status: "known", repo: "x/a" }]]));
    const info = call("s", "/w/a");

    expect(watch.observe(info, "/w")).toEqual(watch.observe(info, "/w"));
    expect(watch.observe(info, "/w")).toHaveLength(1);
  });

  test("keeps sessions apart", () => {
    const answers = new Map<string, Lookup>();
    const { watch } = watchOver(answers);
    watch.observe(call("s1", "/w/a"), "/w");
    answers.set("/w/a", { status: "known", repo: "x/a" });

    expect(watch.observe(call("s2"), "/w")).toEqual([]);
  });

  test("forgetting a session drops its pending roots and lets failed lookups retry", () => {
    const answers = new Map<string, Lookup>();
    const { watch, retried } = watchOver(answers);
    watch.observe(call("s", "/w/a"), "/w");
    watch.forget("s");
    answers.set("/w/a", { status: "known", repo: "x/a" });

    expect(watch.observe(call("s"), "/w")).toEqual([]);
    expect(retried.count).toBe(1);
  });
});

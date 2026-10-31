import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIRST_ID, SESSION, useRuntime, WEB_SESSION } from "../../test/runtime-fixture";
import type { ToolCallInfo } from "./port";

const runtime = useRuntime();
const noOutputMutation = useRuntime({
  capabilities: {
    systemInjection: true,
    toolOutputMutation: false,
    compactionHook: true,
    toast: true,
  },
});

const API = "github.com/acme/api";
const WEB = "github.com/acme/web";

function readIn(sessionID: string, filePath: string): ToolCallInfo {
  return {
    sessionID,
    tool: "read",
    args: { filePath },
    touchedPaths: [filePath],
    appendable: true,
  };
}

const productRule = {
  kind: "rule",
  scope: "product",
  title: "Amounts are integer cents",
  body: "Never floats.",
  why: "Rounding errors between api and web.",
};

describe("products", () => {
  test("a product rule saved after linking reaches the next session of both repos", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_link", { repos: [API, WEB], product: "payments" }, SESSION);

    expect(await fx.host.callTool("memory_save", productRule, SESSION)).toStartWith(
      `Saved [${FIRST_ID}] rule · product:payments`,
    );
    fx.host.sessions.set("ses_api_next", { id: "ses_api_next", directory: "/work/api" });
    const [apiBlock] = await fx.host.emitSystem("ses_api_next");
    const [webBlock] = await fx.host.emitSystem(WEB_SESSION);

    expect(apiBlock).toContain("Amounts are integer cents");
    expect(webBlock).toContain("Amounts are integer cents");
  });

  test("an unlinked repo has no product scope to save to", async () => {
    const fx = runtime();

    expect(await fx.host.callTool("memory_save", productRule, SESSION)).toBe(
      `Not saved: this session has no product scope; it has user, org:github.com/acme, repo:${API}.`,
    );
  });

  test("a declined pair is recorded in the runtime's registry", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_link", { repos: [API, WEB], decline: true }, SESSION);

    expect(JSON.parse(readFileSync(join(fx.dataDir, "registry.json"), "utf8"))).toMatchObject({
      declined: [[API, WEB]],
    });
  });

  test("/memory link lets this session save to the product at once", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_command", { args: "link payments" }, SESSION);

    expect(await fx.host.callTool("memory_save", productRule, SESSION)).toStartWith(
      `Saved [${FIRST_ID}] rule · product:payments`,
    );
  });
});

// A repo's origin is looked up off the tool call's path, so the hint rides on the call after it.
async function settled(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("working across two repos", () => {
  test("the call after the first into the other repo carries exactly one hint", async () => {
    const fx = runtime();

    const first = await fx.host.emitToolAfter(readIn(SESSION, "/work/web/src/cart.ts"));
    await settled();
    const second = await fx.host.emitToolAfter(readIn(SESSION, "/work/web/src/checkout.ts"));
    const third = await fx.host.emitToolAfter(readIn(SESSION, "/work/web/src/cart.ts"));
    const own = await fx.host.emitToolAfter(readIn(SESSION, "/work/api/src/server.ts"));

    expect(first).toEqual([]);
    expect(second).toEqual([
      [
        `waymark · this session's repo is ${API}; this call touched another repo, ${WEB}.`,
        "Ask the user, in your own words, whether both repos belong to one product, so memories saved to the product apply in both.",
        `Record the answer: yes: memory_link with repos ["${API}", "${WEB}"] and product set to the name the user chooses; no: memory_link with the same repos and decline true, and waymark will not ask again.`,
      ].join("\n"),
    ]);
    expect(third).toEqual([]);
    expect(own).toEqual([]);
  });

  test("after a No the pair is never hinted again, in later sessions and activations", async () => {
    const fx = runtime();
    await fx.host.emitToolAfter(readIn(SESSION, "/work/web/src/cart.ts"));
    await fx.host.callTool("memory_link", { repos: [API, WEB], decline: true }, SESSION);
    const next = fx.restart();
    next.host.sessions.set("ses_later", { id: "ses_later", directory: "/work/api" });
    await next.host.emitToolAfter(readIn("ses_later", "/work/web/src/cart.ts"));
    await settled();

    expect(await next.host.emitToolAfter(readIn("ses_later", "/work/web/src/cart.ts"))).toEqual([]);
    await next.host.emitToolAfter(readIn(WEB_SESSION, "/work/api/src/server.ts"));
    await settled();

    expect(await next.host.emitToolAfter(readIn(WEB_SESSION, "/work/api/src/server.ts"))).toEqual(
      [],
    );
  });

  test("after a Yes the linked repos are not hinted about each other", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_link", { repos: [API, WEB], product: "payments" }, SESSION);
    await fx.host.emitToolAfter(readIn(WEB_SESSION, "/work/api/src/server.ts"));
    await settled();

    expect(await fx.host.emitToolAfter(readIn(WEB_SESSION, "/work/api/src/server.ts"))).toEqual([]);
  });

  test("an unanswered hint is shown again in the next session", async () => {
    const fx = runtime();
    await fx.host.emitToolAfter(readIn(SESSION, "/work/web/src/cart.ts"));
    fx.host.sessions.set("ses_next", { id: "ses_next", directory: "/work/api" });

    expect(await fx.host.emitToolAfter(readIn("ses_next", "/work/web/src/cart.ts"))).toHaveLength(
      1,
    );
  });

  test("a deleted session is forgotten, so its id starts over", async () => {
    const fx = runtime();
    await fx.host.emitToolAfter(readIn(SESSION, "/work/web/src/cart.ts"));
    await fx.host.emitSessionEvent({ type: "deleted", sessionID: SESSION });

    expect(await fx.host.emitToolAfter(readIn(SESSION, "/work/web/src/cart.ts"))).toHaveLength(1);
  });

  test("a host that cannot append to tool output gets no hint hook", async () => {
    const fx = noOutputMutation();

    expect(await fx.host.emitToolAfter(readIn(SESSION, "/work/web/src/cart.ts"))).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import {
  FIRST_ID,
  type RuntimeFixture,
  SESSION,
  useRuntime,
  WEB_SESSION,
} from "../../test/runtime-fixture";
import type { ToolCallInfo } from "./port";

const runtime = useRuntime();

const API = "github.com/acme/api";
const WEB = "github.com/acme/web";

const boundary = {
  kind: "decision",
  scope: "product",
  title: "web owns the cart",
  body: "Other repos only ever get the cart id.",
  why: "Ownership of cart data.",
  triggers: { repos: [WEB] },
};

async function linked(): Promise<RuntimeFixture> {
  const fx = runtime();
  await fx.host.callTool("memory_link", { repos: [API, WEB], product: "payments" }, SESSION);
  return fx;
}

function readIn(filePath: string): ToolCallInfo {
  return {
    sessionID: SESSION,
    tool: "read",
    args: { filePath },
    touchedPaths: [filePath],
    appendable: true,
  };
}

// A repo's origin is looked up off the tool call's path, so the match follows the first call.
async function touchWeb(fx: RuntimeFixture): Promise<string[]> {
  await fx.host.emitToolAfter(readIn("/work/web/src/cart.ts"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  return await fx.host.emitToolAfter(readIn("/work/web/src/cart.ts"));
}

describe("saving a memory that targets repos", () => {
  test("is saved at product scope for a member repo", async () => {
    const fx = await linked();

    expect(await fx.host.callTool("memory_save", boundary, SESSION)).toStartWith(
      `Saved [${FIRST_ID}] decision · product:payments`,
    );
  });

  test("is refused outside product scope, saying why", async () => {
    const fx = await linked();

    const reply = await fx.host.callTool("memory_save", { ...boundary, scope: "repo" }, SESSION);

    expect(reply).toBe(
      "Not saved: triggers.repos only works at product scope; a repo-scope memory already reaches only its repo.",
    );
  });

  test("is refused for a repo outside the product, listing the product's repos", async () => {
    const fx = await linked();

    const reply = await fx.host.callTool(
      "memory_save",
      { ...boundary, triggers: { repos: ["github.com/acme/ghost"] } },
      SESSION,
    );

    expect(reply).toBe(
      `Not saved: triggers.repos has github.com/acme/ghost, not in product payments; its repos are: ${API}, ${WEB}.`,
    );
  });

  test("an update aimed at a repo outside the product is refused", async () => {
    const fx = await linked();
    await fx.host.callTool("memory_save", boundary, SESSION);

    const reply = await fx.host.callTool(
      "memory_update",
      { id: FIRST_ID, triggers: { repos: ["github.com/acme/ghost"] } },
      SESSION,
    );

    expect(reply).toStartWith("Not updated: triggers.repos has github.com/acme/ghost");
  });

  test("an update may keep or change targets within the product", async () => {
    const fx = await linked();
    await fx.host.callTool("memory_save", boundary, SESSION);

    const reply = await fx.host.callTool(
      "memory_update",
      { id: FIRST_ID, triggers: { repos: [API] } },
      SESSION,
    );

    expect(reply).toStartWith(`Updated [${FIRST_ID}]`);
  });
});

describe("delivery of a memory that targets repos", () => {
  test("arrives in full when a call touches the targeted repo", async () => {
    const fx = await linked();
    await fx.host.callTool("memory_save", boundary, SESSION);

    const delivered = await touchWeb(fx);

    expect(delivered.join("\n")).toContain("Other repos only ever get the cart id.");
  });

  test("arrives once per session", async () => {
    const fx = await linked();
    await fx.host.callTool("memory_save", boundary, SESSION);
    await touchWeb(fx);

    expect(await fx.host.emitToolAfter(readIn("/work/web/src/cart.ts"))).toEqual([]);
  });

  test("does not arrive for a call in the session's own repo", async () => {
    const fx = await linked();
    await fx.host.callTool("memory_save", boundary, SESSION);

    const own = await fx.host.emitToolAfter(readIn("/work/api/src/server.ts"));

    expect(own).toEqual([]);
  });

  test("is listed in the session index prefixed with the short repo name", async () => {
    const fx = await linked();
    await fx.host.callTool("memory_save", boundary, SESSION);
    fx.host.sessions.set("ses_next", { id: "ses_next", directory: "/work/api" });

    const [block] = await fx.host.emitSystem("ses_next");

    expect(block).toContain(`- [${FIRST_ID}] [web] web owns the cart (2026-03-01)`);
  });

  test("keeps a rule aimed at a repo out of the always-on block and lists it with its repo", async () => {
    const fx = await linked();
    await fx.host.callTool("memory_save", { ...boundary, kind: "rule" }, SESSION);
    fx.host.sessions.set("ses_next", { id: "ses_next", directory: "/work/api" });

    const [block] = await fx.host.emitSystem("ses_next");

    expect(block).not.toContain("### Rules");
    expect(block).toContain(`- [${FIRST_ID}] [web] web owns the cart`);
    expect((await touchWeb(fx)).join("\n")).toContain("Other repos only ever get the cart id.");
  });

  test("stops firing once the repo is unlinked from the product", async () => {
    const fx = await linked();
    await fx.host.callTool("memory_save", boundary, SESSION);
    await fx.host.callTool("memory_command", { args: "unlink" }, WEB_SESSION);

    expect(await touchWeb(fx)).toEqual([]);
  });
});

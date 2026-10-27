import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIRST_ID, SESSION, useRuntime, WEB_SESSION } from "../../test/runtime-fixture";

const runtime = useRuntime();

const API = "github.com/acme/api";
const WEB = "github.com/acme/web";

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

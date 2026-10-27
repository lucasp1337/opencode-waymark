import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  API_SESSION,
  NOTES_SESSION,
  useCommandFixture,
  WEB_SESSION,
} from "../../../../test/commands-fixture";

const fixture = useCommandFixture();

const API = "github.com/acme/api";
const WEB = "github.com/acme-labs/web";

describe("/memory link", () => {
  test("creates the product with this session's repo and puts it on the session's chain", async () => {
    const fx = fixture();

    expect(await fx.run("link payments")).toBe(
      [
        `Created product payments with ${API}.`,
        "Save what holds in all of these repos with scope product. Sessions that start from now on in any of them show the product's memories.",
      ].join("\n"),
    );
    expect(await fx.scopes.chainFor(API_SESSION)).toContainEqual({
      level: "product",
      id: "payments",
    });
  });

  test("a repo of another org joins the same product", async () => {
    const fx = fixture();
    await fx.run("link payments");

    expect(await fx.run("link payments", WEB_SESSION)).toStartWith(
      `Product payments now links ${API}, ${WEB}.`,
    );
  });

  test("a repo already in another product is refused", async () => {
    const fx = fixture();
    await fx.run("link payments");

    expect(await fx.run("link storefront")).toBe(
      `Not linked: ${API} is in product payments. A repo leaves its product with /memory unlink.`,
    );
  });

  test("a session outside a repo has nothing to link", async () => {
    const fx = fixture();

    expect(await fx.run("link payments", NOTES_SESSION)).toBe(
      "Not linked: this session does not run in a repo.",
    );
  });
});

describe("/memory unlink", () => {
  test("takes this session's repo out and records a No for the repos left", async () => {
    const fx = fixture();
    await fx.run("link payments");
    await fx.run("link payments", WEB_SESSION);

    expect(await fx.run("unlink")).toBe(
      [
        `Unlinked ${API} from product payments. Its memories stay with the product.`,
        `Waymark will not suggest linking ${API} with ${WEB} again.`,
      ].join("\n"),
    );
    expect(JSON.parse(readFileSync(fx.registryFile, "utf8"))).toMatchObject({
      products: { payments: { repos: [WEB] } },
      // Pairs are stored sorted: "acme-labs" sorts before "acme/".
      declined: [[WEB, API]],
    });
    expect(await fx.scopes.chainFor(API_SESSION)).not.toContainEqual({
      level: "product",
      id: "payments",
    });
  });

  test("the last repo out says how to bring the product's memories back", async () => {
    const fx = fixture();
    await fx.run("link payments");

    expect(await fx.run("unlink")).toBe(
      [
        `Unlinked ${API} from product payments. Its memories stay with the product.`,
        "No repo is left in payments; /memory link payments brings its memories back to a repo.",
      ].join("\n"),
    );
  });

  test("a repo in no product is refused", async () => {
    const fx = fixture();

    expect(await fx.run("unlink")).toBe(`Not unlinked: ${API} is not in a product.`);
  });

  test("a session outside a repo has nothing to unlink", async () => {
    const fx = fixture();

    expect(await fx.run("unlink", NOTES_SESSION)).toBe(
      "Not unlinked: this session does not run in a repo.",
    );
  });
});

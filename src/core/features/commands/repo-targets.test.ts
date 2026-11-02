import { describe, expect, test } from "bun:test";
import {
  API_SESSION,
  idNumber,
  useCommandFixture,
  WEB_SESSION,
} from "../../../../test/commands-fixture";
import { err } from "../../model/result";
import { reviewReport } from "./review-report";

const fixture = useCommandFixture();

const API = "github.com/acme/api";
const WEB = "github.com/acme-labs/web";
const PAYMENTS = { level: "product", id: "payments" } as const;

function boundary(repos: string[]) {
  return {
    kind: "decision",
    title: "web owns the cart",
    body: "Others get the cart id only.",
    why: "ownership",
    triggers: { repos },
  } as const;
}

async function payments() {
  const fx = fixture();
  await fx.run("link payments");
  await fx.run("link payments", WEB_SESSION);
  return fx;
}

describe("memory_command review of repo targets", () => {
  test("lists product repos that no memory is aimed at", async () => {
    const fx = await payments();
    fx.seed({ n: 1, scope: PAYMENTS, content: boundary([WEB]) });

    const report = await fx.run("review");

    expect(report).toContain(
      `Repos of this product no memory is aimed at (triggers.repos):\n- ${API}`,
    );
    expect(report).not.toContain(`- ${WEB}\n`);
  });

  test("lists a memory aimed at a repo that left the product", async () => {
    const fx = await payments();
    fx.seed({ n: 1, scope: PAYMENTS, content: boundary([WEB]) });
    await fx.run("unlink", WEB_SESSION);

    const report = await fx.run("review");

    expect(report).toContain(
      `Aimed at a repo that left the product, so they no longer fire:\n- [${idNumber(1)}] decision · product:payments · web owns the cart (2026-03-01) (aimed at ${WEB})`,
    );
  });

  test("reports nothing about repo targets outside a product", async () => {
    const fx = fixture();

    expect(await fx.run("review")).toStartWith("Nothing needs review");
  });

  test("says so when the product's repos cannot be read", async () => {
    const fx = await payments();
    const chain = await fx.scopes.chainFor(API_SESSION);

    const report = reviewReport({ store: fx.store, productRepos: () => err("bad json") }, chain, {
      leftIndex: [],
      noisy: [],
    });

    expect(report).toContain(
      "Repo targets not checked:\n- the repos of product payments could not be read (bad json)",
    );
  });
});

describe("memory_command move of a memory aimed at repos", () => {
  test("refuses to leave product scope, saying why", async () => {
    const fx = await payments();
    fx.seed({ n: 1, scope: PAYMENTS, content: boundary([WEB]) });

    const reply = await fx.run(`move ${idNumber(1)} user`);

    expect(reply).toBe(
      "Not moved: triggers.repos only works at product scope; a repo-scope memory already reaches only its repo; remove triggers.repos with memory_update first.",
    );
    expect(fx.store.get(idNumber(1))?.scope).toEqual(PAYMENTS);
  });

  test("refuses to move into a product that lacks the targets, listing its repos", async () => {
    const fx = await payments();
    await fx.run("unlink", WEB_SESSION);
    await fx.run("link other", WEB_SESSION);
    fx.seed({ n: 1, scope: PAYMENTS, content: boundary([API]) });

    const reply = await fx.run(`move ${idNumber(1)} product`, WEB_SESSION);

    expect(reply).toBe(
      `Not moved: triggers.repos has ${API}, not in product other; its repos are: ${WEB}.`,
    );
  });
});

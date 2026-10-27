import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDirs } from "../../../../test/temp-dir";
import { declinePair, linkRepos } from "../../scope/products";
import { nodeFileSystem } from "../../store/fs";
import { memoryLinkTool } from "./memory-link";

const tempDir = useTempDirs();

const API = "github.com/acme/api";
const WEB = "github.com/acme/web";
const DOCS = "github.com/acme/docs";

function setup() {
  const registryFile = join(tempDir(), "registry.json");
  const tool = memoryLinkTool({ fs: nodeFileSystem, registryFile });
  return {
    registryFile,
    link: (input: unknown) => tool.execute(input, { sessionID: "ses_a" }),
    registry: (): unknown => JSON.parse(readFileSync(registryFile, "utf8")),
  };
}

describe("memory_link", () => {
  test("creates a named product from the repos and says how to use it", async () => {
    const { link, registry } = setup();

    expect(await link({ repos: [API, WEB], product: "payments" })).toBe(
      [
        `Created product payments with ${API}, ${WEB}.`,
        "Save what holds in all of these repos with scope product. Sessions that start from now on in any of them show the product's memories.",
      ].join("\n"),
    );
    expect(registry()).toEqual({ products: { payments: { repos: [API, WEB] } } });
  });

  test("without a product the repos join the product one of them is in", async () => {
    const { link, registryFile } = setup();
    linkRepos(nodeFileSystem, registryFile, { repos: [API], product: "payments" });

    expect(await link({ repos: [API, WEB] })).toStartWith(
      `Product payments now links ${API}, ${WEB}.`,
    );
  });

  test("without a product and no product among the repos nothing is linked", async () => {
    const { link, registryFile } = setup();

    expect(await link({ repos: [API, WEB] })).toBe(
      "Not linked: none of these repos is in a product yet; name the product to create.",
    );
    expect(nodeFileSystem.readText(registryFile)).toBeUndefined();
  });

  test("a repo in another product is refused", async () => {
    const { link, registryFile } = setup();
    linkRepos(nodeFileSystem, registryFile, { repos: [WEB], product: "storefront" });

    expect(await link({ repos: [API, WEB], product: "payments" })).toBe(
      `Not linked: ${WEB} is in product storefront. A repo leaves its product with /memory unlink.`,
    );
  });

  test("a repo listed twice is linked once", async () => {
    const { link, registry } = setup();

    await link({ repos: [API, API, WEB], product: "payments" });

    expect(registry()).toEqual({ products: { payments: { repos: [API, WEB] } } });
  });

  test("decline records the user's No for the pair", async () => {
    const { link, registry } = setup();

    expect(await link({ repos: [WEB, API], decline: true })).toBe(
      `Recorded: ${WEB} and ${API} are not one product. Waymark will not suggest linking them again.`,
    );
    expect(registry()).toEqual({ declined: [[API, WEB]] });
  });

  test("decline false links as usual", async () => {
    const { link } = setup();

    expect(await link({ repos: [API], product: "payments", decline: false })).toStartWith(
      `Created product payments with ${API}.`,
    );
  });

  test("two repos of one product cannot be declined", async () => {
    const { link, registryFile } = setup();
    linkRepos(nodeFileSystem, registryFile, { repos: [API, WEB], product: "payments" });

    expect(await link({ repos: [API, WEB], decline: true })).toBe(
      `Not recorded: ${API} and ${WEB} are linked as product payments; /memory unlink separates them.`,
    );
  });

  test("a No already recorded is accepted again without a change", async () => {
    const { link, registryFile, registry } = setup();
    declinePair(nodeFileSystem, registryFile, [API, WEB]);

    expect(await link({ repos: [API, WEB], decline: true })).toStartWith("Recorded:");
    expect(registry()).toEqual({ declined: [[API, WEB]] });
  });

  test.each([
    ["three repos", { repos: [API, WEB, DOCS], decline: true }, "decline takes exactly two repos"],
    ["one repo", { repos: [API], decline: true }, "decline takes exactly two repos"],
    [
      "a product",
      { repos: [API, WEB], product: "payments", decline: true },
      "a declined pair takes no product",
    ],
  ])("a decline with %s is refused", async (_case, input, problem) => {
    const { link, registryFile } = setup();

    expect(await link(input)).toBe(`Not linked: ${problem}`);
    expect(nodeFileSystem.readText(registryFile)).toBeUndefined();
  });

  test.each([
    ["no repos", {}],
    ["an empty list", { repos: [] }],
    ["a repo that is not text", { repos: [API, 7] }],
    ["a repo id that leaves the data directory", { repos: ["../x"] }],
    ["repos given as text", { repos: API }],
  ])("%s is refused", async (_case, input) => {
    const { link } = setup();

    expect(await link({ product: "payments", ...input })).toBe(
      "Not linked: repos must be a list of repo ids as Waymark named them",
    );
  });

  test.each([
    ["a path", "acme/payments"],
    ["two words", "two words"],
    ["a number", 3],
  ])("a product name that is %s is refused", async (_case, product) => {
    const { link } = setup();

    expect(await link({ repos: [API], product })).toBe(
      "Not linked: product must be a plain name such as payments (letters, digits, . _ ~ -)",
    );
  });

  test("every problem of the input is named at once", async () => {
    const { link } = setup();

    expect(await link({ repos: [], product: "a/b", decline: "yes" })).toBe(
      [
        "Not linked: repos must be a list of repo ids as Waymark named them",
        "product must be a plain name such as payments (letters, digits, . _ ~ -)",
        "decline must be true or false",
      ].join("; "),
    );
  });
});

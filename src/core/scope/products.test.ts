import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDirs } from "../../../test/temp-dir";
import { err } from "../model/result";
import { type FileSystem, nodeFileSystem } from "../store/fs";
import {
  declinePair,
  isProductName,
  linkRepos,
  pairStatus,
  productNameOf,
  productOf,
  unlinkRepo,
} from "./products";

const tempDir = useTempDirs();

const API = "github.com/acme/api";
const WEB = "github.com/acme/web";
const DOCS = "github.com/acme/docs";

function registryFile(content?: unknown): string {
  const file = join(tempDir(), "registry.json");
  if (content !== undefined) {
    nodeFileSystem.writeAtomic(
      file,
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }
  return file;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function countingFileSystem(): { fs: FileSystem; writes: string[] } {
  const writes: string[] = [];
  const fs: FileSystem = {
    ...nodeFileSystem,
    writeAtomic(path, text) {
      writes.push(path);
      nodeFileSystem.writeAtomic(path, text);
    },
  };
  return { fs, writes };
}

async function linked(product: string, ...repos: string[]): Promise<string> {
  const file = registryFile();
  await linkRepos(nodeFileSystem, file, { repos, product });
  return file;
}

describe("isProductName", () => {
  test.each(["payments", "web-app", "v2.0"])("%s is a product name", (name) => {
    expect(isProductName(name)).toBe(true);
  });

  test.each(["", "a/b", "..", ".", "two words", "naïve", "Payments"])("%p is not", (name) => {
    expect(isProductName(name)).toBe(false);
  });
});

describe("productNameOf", () => {
  test("keeps the registry's one spelling: lower case", () => {
    expect(productNameOf("Payments")).toBe("payments");
  });

  test("is undefined for text that is not a product name in any case", () => {
    expect(productNameOf("Acme/Payments")).toBeUndefined();
  });
});

describe("linkRepos", () => {
  test("creates a named product with the repos", async () => {
    const file = registryFile();

    expect(
      await linkRepos(nodeFileSystem, file, { repos: [API, WEB], product: "payments" }),
    ).toEqual({
      ok: true,
      value: { product: "payments", repos: [API, WEB], created: true },
    });
    expect(readJson(file)).toEqual({ products: { payments: { repos: [API, WEB] } } });
  });

  test("a repo joins an existing product after the repos already in it", async () => {
    const file = await linked("payments", API, WEB);

    expect(await linkRepos(nodeFileSystem, file, { repos: [DOCS], product: "payments" })).toEqual({
      ok: true,
      value: { product: "payments", repos: [API, WEB, DOCS], created: false },
    });
  });

  test("without a name the repos join the product one of them is in", async () => {
    const file = await linked("payments", API);

    expect(await linkRepos(nodeFileSystem, file, { repos: [API, WEB] })).toEqual({
      ok: true,
      value: { product: "payments", repos: [API, WEB], created: false },
    });
  });

  test("linking a repo that is already in the product adds it once", async () => {
    const file = await linked("payments", API, WEB);

    await linkRepos(nodeFileSystem, file, { repos: [WEB, API], product: "payments" });

    expect(readJson(file)).toEqual({ products: { payments: { repos: [API, WEB] } } });
  });

  test("without a name and no product among the repos, nothing is linked", async () => {
    const file = registryFile();
    const { fs, writes } = countingFileSystem();

    expect(await linkRepos(fs, file, { repos: [API, WEB] })).toEqual({
      ok: false,
      error: "none of these repos is in a product yet; name the product to create.",
    });
    expect(writes).toEqual([]);
  });

  test("without a name, repos in two products are refused", async () => {
    const file = await linked("payments", API);
    await linkRepos(nodeFileSystem, file, { repos: [WEB], product: "storefront" });

    expect(await linkRepos(nodeFileSystem, file, { repos: [API, WEB] })).toEqual({
      ok: false,
      error:
        "these repos are in different products: payments, storefront. A repo leaves its product with /memory unlink.",
    });
  });

  test("a repo in another product is refused and named, and nothing is written", async () => {
    const file = await linked("storefront", WEB);
    const { fs, writes } = countingFileSystem();

    expect(await linkRepos(fs, file, { repos: [API, WEB], product: "payments" })).toEqual({
      ok: false,
      error: `${WEB} is in product storefront. A repo leaves its product with /memory unlink.`,
    });
    expect(writes).toEqual([]);
  });

  test("keys and product fields this version does not know are preserved", async () => {
    const file = registryFile({
      version: 3,
      orgs: { "github.com/acme": { owner: "acme" } },
      products: { payments: { repos: [API], note: "kept" } },
    });

    await linkRepos(nodeFileSystem, file, { repos: [WEB], product: "payments" });

    expect(readJson(file)).toEqual({
      version: 3,
      orgs: { "github.com/acme": { owner: "acme" } },
      products: { payments: { repos: [API, WEB], note: "kept" } },
    });
  });
});

describe("productOf", () => {
  test("names the product a repo is linked to", async () => {
    expect(productOf(nodeFileSystem, await linked("payments", API, WEB), WEB)).toEqual({
      ok: true,
      value: "payments",
    });
  });

  test("is undefined for a repo in no product, also without a registry file", async () => {
    expect(productOf(nodeFileSystem, await linked("payments", API), WEB)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(productOf(nodeFileSystem, registryFile(), API)).toEqual({ ok: true, value: undefined });
  });
});

describe("unlinkRepo", () => {
  test("takes the repo out and records a No for it with each repo left", async () => {
    const file = await linked("payments", API, WEB, DOCS);

    expect(await unlinkRepo(nodeFileSystem, file, WEB)).toEqual({
      ok: true,
      value: { product: "payments", remaining: [API, DOCS] },
    });
    expect(readJson(file)).toEqual({
      products: { payments: { repos: [API, DOCS] } },
      declined: [
        [API, WEB],
        [DOCS, WEB],
      ],
    });
  });

  test("the last repo leaves the product's name behind for a later link", async () => {
    const file = await linked("payments", API);

    await unlinkRepo(nodeFileSystem, file, API);

    expect(readJson(file)).toEqual({ products: { payments: { repos: [] } }, declined: [] });
    expect(await linkRepos(nodeFileSystem, file, { repos: [API], product: "payments" })).toEqual({
      ok: true,
      value: { product: "payments", repos: [API], created: false },
    });
  });

  test("a No already recorded is not recorded twice", async () => {
    const file = await linked("payments", API, WEB);
    await declinePair(nodeFileSystem, file, [DOCS, API]);
    await linkRepos(nodeFileSystem, file, { repos: [DOCS], product: "payments" });

    await unlinkRepo(nodeFileSystem, file, DOCS);

    expect(readJson(file)).toMatchObject({
      declined: [
        [API, DOCS],
        [DOCS, WEB],
      ],
    });
  });

  test("a repo in no product is refused and nothing is written", async () => {
    const file = await linked("payments", API);
    const { fs, writes } = countingFileSystem();

    expect(await unlinkRepo(fs, file, WEB)).toEqual({
      ok: false,
      error: `${WEB} is not in a product.`,
    });
    expect(writes).toEqual([]);
  });
});

describe("declinePair", () => {
  test("records the pair once, whatever its order", async () => {
    const file = registryFile();
    const { fs, writes } = countingFileSystem();

    expect(await declinePair(fs, file, [WEB, API])).toEqual({ ok: true, value: undefined });
    await declinePair(fs, file, [API, WEB]);

    expect(readJson(file)).toEqual({ declined: [[API, WEB]] });
    expect(writes).toHaveLength(1);
  });

  test("two repos of one product cannot be declined", async () => {
    const file = await linked("payments", API, WEB);

    expect(await declinePair(nodeFileSystem, file, [API, WEB])).toEqual({
      ok: false,
      error: `${API} and ${WEB} are linked as product payments; /memory unlink separates them.`,
    });
  });
});

describe("pairStatus", () => {
  test("reports the product of each repo and a recorded No in either order", async () => {
    const file = await linked("payments", API);
    await declinePair(nodeFileSystem, file, [API, WEB]);

    expect(pairStatus(nodeFileSystem, file, [WEB, API])).toEqual({
      ok: true,
      value: { products: [undefined, "payments"], declined: true },
    });
  });

  test("a pair written unsorted by hand is still found, and rewritten sorted", async () => {
    const file = registryFile({ declined: [[WEB, API]] });

    expect(pairStatus(nodeFileSystem, file, [API, WEB])).toMatchObject({
      value: { declined: true },
    });
    await declinePair(nodeFileSystem, file, [API, DOCS]);
    expect(readJson(file)).toEqual({
      declined: [
        [API, WEB],
        [API, DOCS],
      ],
    });
  });

  test("two repos nobody answered about are not declined", () => {
    expect(pairStatus(nodeFileSystem, registryFile(), [API, WEB])).toEqual({
      ok: true,
      value: { products: [undefined, undefined], declined: false },
    });
  });
});

describe("a registry that cannot be understood", () => {
  test.each([
    ["products that is a list", { products: [] }, '"products" must be a JSON object'],
    [
      "a product without repos",
      { products: { payments: {} } },
      'product "payments" must be an object with a "repos" list of repo ids',
    ],
    [
      "repos that are not ids",
      { products: { payments: { repos: [1] } } },
      'product "payments" must be an object with a "repos" list of repo ids',
    ],
    [
      "a product name that is a path",
      { products: { "../x": { repos: [] } } },
      'product "../x" is not a plain name',
    ],
    [
      "a product name in upper case",
      { products: { Payments: { repos: [] } } },
      'product "Payments" is not a plain name',
    ],
    [
      "a repo in two products",
      { products: { payments: { repos: [API] }, storefront: { repos: [WEB, API] } } },
      `repo ${API} is in products "payments" and "storefront"`,
    ],
    ["declined that is an object", { declined: {} }, '"declined" must be a list of repo id pairs'],
    [
      "a declined entry of three repos",
      { declined: [[API, WEB, DOCS]] },
      '"declined" must be a list of repo id pairs',
    ],
  ])("with %s is reported and left unchanged", async (_case, content, problem) => {
    const file = registryFile(content);
    const { fs, writes } = countingFileSystem();
    const expected = err(`registry ${file} ${problem}`);

    expect(productOf(fs, file, API)).toEqual(expected);
    expect(pairStatus(fs, file, [API, WEB])).toEqual(expected);
    expect(await linkRepos(fs, file, { repos: [API], product: "payments" })).toEqual(expected);
    expect(await unlinkRepo(fs, file, API)).toEqual(expected);
    expect(await declinePair(fs, file, [API, WEB])).toEqual(expected);
    expect(writes).toEqual([]);
  });

  test("corrupt JSON is reported with the file's name", () => {
    const file = registryFile("{ not json");

    const result = productOf(nodeFileSystem, file, API);

    expect(!result.ok && result.error).toStartWith(`registry ${file} is not valid JSON (`);
  });

  test("an I/O error from the file system propagates instead of becoming an error value", () => {
    const fs: FileSystem = {
      ...nodeFileSystem,
      readText() {
        throw new Error("disk unreadable");
      },
    };

    expect(() => productOf(fs, registryFile(), API)).toThrow("disk unreadable");
  });
});

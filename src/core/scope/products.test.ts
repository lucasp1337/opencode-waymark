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

function linked(product: string, ...repos: string[]): string {
  const file = registryFile();
  linkRepos(nodeFileSystem, file, { repos, product });
  return file;
}

describe("isProductName", () => {
  test.each(["payments", "web-app", "v2.0"])("%s is a product name", (name) => {
    expect(isProductName(name)).toBe(true);
  });

  test.each(["", "a/b", "..", ".", "two words", "naïve"])("%p is not", (name) => {
    expect(isProductName(name)).toBe(false);
  });
});

describe("linkRepos", () => {
  test("creates a named product with the repos", () => {
    const file = registryFile();

    expect(linkRepos(nodeFileSystem, file, { repos: [API, WEB], product: "payments" })).toEqual({
      ok: true,
      value: { product: "payments", repos: [API, WEB], created: true },
    });
    expect(readJson(file)).toEqual({ products: { payments: { repos: [API, WEB] } } });
  });

  test("a repo joins an existing product after the repos already in it", () => {
    const file = linked("payments", API, WEB);

    expect(linkRepos(nodeFileSystem, file, { repos: [DOCS], product: "payments" })).toEqual({
      ok: true,
      value: { product: "payments", repos: [API, WEB, DOCS], created: false },
    });
  });

  test("without a name the repos join the product one of them is in", () => {
    const file = linked("payments", API);

    expect(linkRepos(nodeFileSystem, file, { repos: [API, WEB] })).toEqual({
      ok: true,
      value: { product: "payments", repos: [API, WEB], created: false },
    });
  });

  test("linking a repo that is already in the product adds it once", () => {
    const file = linked("payments", API, WEB);

    linkRepos(nodeFileSystem, file, { repos: [WEB, API], product: "payments" });

    expect(readJson(file)).toEqual({ products: { payments: { repos: [API, WEB] } } });
  });

  test("without a name and no product among the repos, nothing is linked", () => {
    const file = registryFile();
    const { fs, writes } = countingFileSystem();

    expect(linkRepos(fs, file, { repos: [API, WEB] })).toEqual({
      ok: false,
      error: "none of these repos is in a product yet; name the product to create.",
    });
    expect(writes).toEqual([]);
  });

  test("without a name, repos in two products are refused", () => {
    const file = linked("payments", API);
    linkRepos(nodeFileSystem, file, { repos: [WEB], product: "storefront" });

    expect(linkRepos(nodeFileSystem, file, { repos: [API, WEB] })).toEqual({
      ok: false,
      error:
        "these repos are in different products: payments, storefront. A repo leaves its product with /memory unlink.",
    });
  });

  test("a repo in another product is refused and named, and nothing is written", () => {
    const file = linked("storefront", WEB);
    const { fs, writes } = countingFileSystem();

    expect(linkRepos(fs, file, { repos: [API, WEB], product: "payments" })).toEqual({
      ok: false,
      error: `${WEB} is in product storefront. A repo leaves its product with /memory unlink.`,
    });
    expect(writes).toEqual([]);
  });

  test("keys and product fields this version does not know are preserved", () => {
    const file = registryFile({
      version: 3,
      orgs: { "github.com/acme": { owner: "acme" } },
      products: { payments: { repos: [API], note: "kept" } },
    });

    linkRepos(nodeFileSystem, file, { repos: [WEB], product: "payments" });

    expect(readJson(file)).toEqual({
      version: 3,
      orgs: { "github.com/acme": { owner: "acme" } },
      products: { payments: { repos: [API, WEB], note: "kept" } },
    });
  });
});

describe("productOf", () => {
  test("names the product a repo is linked to", () => {
    expect(productOf(nodeFileSystem, linked("payments", API, WEB), WEB)).toEqual({
      ok: true,
      value: "payments",
    });
  });

  test("is undefined for a repo in no product, also without a registry file", () => {
    expect(productOf(nodeFileSystem, linked("payments", API), WEB)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(productOf(nodeFileSystem, registryFile(), API)).toEqual({ ok: true, value: undefined });
  });
});

describe("unlinkRepo", () => {
  test("takes the repo out and records a No for it with each repo left", () => {
    const file = linked("payments", API, WEB, DOCS);

    expect(unlinkRepo(nodeFileSystem, file, WEB)).toEqual({
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

  test("the last repo leaves the product's name behind for a later link", () => {
    const file = linked("payments", API);

    unlinkRepo(nodeFileSystem, file, API);

    expect(readJson(file)).toEqual({ products: { payments: { repos: [] } }, declined: [] });
    expect(linkRepos(nodeFileSystem, file, { repos: [API], product: "payments" })).toEqual({
      ok: true,
      value: { product: "payments", repos: [API], created: false },
    });
  });

  test("a No already recorded is not recorded twice", () => {
    const file = linked("payments", API, WEB);
    declinePair(nodeFileSystem, file, [DOCS, API]);
    linkRepos(nodeFileSystem, file, { repos: [DOCS], product: "payments" });

    unlinkRepo(nodeFileSystem, file, DOCS);

    expect(readJson(file)).toMatchObject({
      declined: [
        [API, DOCS],
        [DOCS, WEB],
      ],
    });
  });

  test("a repo in no product is refused and nothing is written", () => {
    const file = linked("payments", API);
    const { fs, writes } = countingFileSystem();

    expect(unlinkRepo(fs, file, WEB)).toEqual({
      ok: false,
      error: `${WEB} is not in a product.`,
    });
    expect(writes).toEqual([]);
  });
});

describe("declinePair", () => {
  test("records the pair once, whatever its order", () => {
    const file = registryFile();
    const { fs, writes } = countingFileSystem();

    expect(declinePair(fs, file, [WEB, API])).toEqual({ ok: true, value: undefined });
    declinePair(fs, file, [API, WEB]);

    expect(readJson(file)).toEqual({ declined: [[API, WEB]] });
    expect(writes).toHaveLength(1);
  });

  test("two repos of one product cannot be declined", () => {
    const file = linked("payments", API, WEB);

    expect(declinePair(nodeFileSystem, file, [API, WEB])).toEqual({
      ok: false,
      error: `${API} and ${WEB} are linked as product payments; /memory unlink separates them.`,
    });
  });
});

describe("pairStatus", () => {
  test("reports the product of each repo and a recorded No in either order", () => {
    const file = linked("payments", API);
    declinePair(nodeFileSystem, file, [API, WEB]);

    expect(pairStatus(nodeFileSystem, file, [WEB, API])).toEqual({
      ok: true,
      value: { products: [undefined, "payments"], declined: true },
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
    ["declined that is an object", { declined: {} }, '"declined" must be a list of repo id pairs'],
    [
      "a declined entry of three repos",
      { declined: [[API, WEB, DOCS]] },
      '"declined" must be a list of repo id pairs',
    ],
  ])("with %s is reported and left unchanged", (_case, content, problem) => {
    const file = registryFile(content);
    const { fs, writes } = countingFileSystem();
    const expected = err(`registry ${file} ${problem}`);

    expect(productOf(fs, file, API)).toEqual(expected);
    expect(pairStatus(fs, file, [API, WEB])).toEqual(expected);
    expect(linkRepos(fs, file, { repos: [API], product: "payments" })).toEqual(expected);
    expect(unlinkRepo(fs, file, API)).toEqual(expected);
    expect(declinePair(fs, file, [API, WEB])).toEqual(expected);
    expect(writes).toEqual([]);
  });

  test("corrupt JSON is reported with the file's name", () => {
    const file = registryFile("{ not json");

    expect(productOf(nodeFileSystem, file, API)).toEqual({
      ok: false,
      error: `registry ${file} is not valid JSON`,
    });
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

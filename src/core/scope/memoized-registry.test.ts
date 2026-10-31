import { describe, expect, test } from "bun:test";
import { existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { useTempDirs } from "../../../test/temp-dir";
import { type FileSystem, nodeFileSystem } from "../store/fs";
import { memoizeRegistryReads } from "./memoized-registry";
import { linkRepos, productRepos, unlinkRepo } from "./products";

const tempDir = useTempDirs();

const FILE = "/data/registry.json";

function fakeFiles(initial: string | undefined) {
  const state = { text: initial, mtimeMs: 1, reads: 0, stats: 0 };
  const fs: FileSystem = {
    readText: () => {
      state.reads += 1;
      return state.text;
    },
    mtimeMs: () => {
      state.stats += 1;
      return state.text === undefined ? undefined : state.mtimeMs;
    },
    sizeBytes: () => state.text?.length,
    writeAtomic: (_path, text) => {
      state.text = text;
    },
    createExclusive: () => false,
    remove: () => undefined,
    move: () => undefined,
    listFiles: () => [],
    realPath: () => undefined,
    isDirectory: () => false,
  };
  return { fs, state };
}

describe("memoizeRegistryReads", () => {
  test("reads the file once while its modification time is unchanged", () => {
    const { fs, state } = fakeFiles("{}");
    const memoized = memoizeRegistryReads(fs, FILE);

    expect(memoized.readText(FILE)).toBe("{}");
    expect(memoized.readText(FILE)).toBe("{}");

    expect(state.reads).toBe(1);
    expect(state.stats).toBe(2);
  });

  test("reads the file again after its modification time changed", () => {
    const { fs, state } = fakeFiles("{}");
    const memoized = memoizeRegistryReads(fs, FILE);
    memoized.readText(FILE);

    state.text = '{"orgs":{}}';
    state.mtimeMs = 2;

    expect(memoized.readText(FILE)).toBe('{"orgs":{}}');
    expect(state.reads).toBe(2);
  });

  test("reports a missing file as missing and reads it once it appears", () => {
    const { fs, state } = fakeFiles(undefined);
    const memoized = memoizeRegistryReads(fs, FILE);

    expect(memoized.readText(FILE)).toBeUndefined();

    state.text = "{}";

    expect(memoized.readText(FILE)).toBe("{}");
  });

  test("a write through it is seen by the next read even when time and size are unchanged", () => {
    const { fs } = fakeFiles("{}");
    const memoized = memoizeRegistryReads(fs, FILE);
    memoized.readText(FILE);

    memoized.writeAtomic(FILE, "[]");

    expect(memoized.readText(FILE)).toBe("[]");
  });

  test("a rewrite that changes only the size is seen although the modification time is the same", () => {
    const { fs, state } = fakeFiles("{}");
    const memoized = memoizeRegistryReads(fs, FILE);
    memoized.readText(FILE);

    state.text = '{"orgs":{}}';

    expect(memoized.readText(FILE)).toBe('{"orgs":{}}');
  });

  test("passes reads of other files through", () => {
    const { fs, state } = fakeFiles("{}");
    const memoized = memoizeRegistryReads(fs, FILE);

    memoized.readText("/data/other.json");
    memoized.readText("/data/other.json");

    expect(state.reads).toBe(2);
  });
});

describe("registry writers through the memoized file system", () => {
  test("a read after unlink sees it although link, read and unlink share one timestamp tick", async () => {
    const file = join(tempDir(), "registry.json");
    const memoized = memoizeRegistryReads(nodeFileSystem, file);
    const sameTick = () => utimesSync(file, 1_700_000_000, 1_700_000_000);

    await linkRepos(memoized, file, { repos: ["x/api"], product: "payments" });
    sameTick();
    expect(productRepos(memoized, file, "payments")).toEqual({ ok: true, value: ["x/api"] });
    await unlinkRepo(memoized, file, "x/api");
    sameTick();

    expect(existsSync(file)).toBe(true);
    expect(productRepos(memoized, file, "payments")).toEqual({ ok: true, value: [] });
  });
});

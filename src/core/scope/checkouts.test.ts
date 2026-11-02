import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDirs } from "../../../test/temp-dir";
import { type FileSystem, nodeFileSystem } from "../store/fs";
import { createCheckoutRecorder, readCheckouts } from "./checkouts";
import { linkRepos } from "./products";
import type { LockTiming } from "./registry-lock";

const tempDir = useTempDirs();

const API = "github.com/acme/api";
const T1 = new Date("2026-05-01T10:00:00.000Z");
const T2 = new Date("2026-05-02T10:00:00.000Z");

interface Logged {
  readonly level: string;
  readonly msg: string;
}

function setup(initial?: string, fs: FileSystem = nodeFileSystem) {
  const file = join(tempDir(), "registry.json");
  if (initial !== undefined) {
    writeFileSync(file, initial);
  }
  const logged: Logged[] = [];
  let now = T1;
  const record = createCheckoutRecorder({
    fs,
    registryFile: file,
    now: () => now,
    log: (level, msg) => {
      logged.push({ level, msg });
    },
  });
  return {
    file,
    logged,
    record,
    at: (time: Date) => {
      now = time;
    },
    stored: (): unknown => JSON.parse(readFileSync(file, "utf8")),
  };
}

function roots(file: string): Record<string, string> {
  const result = readCheckouts(nodeFileSystem, file);
  return result.ok ? Object.fromEntries(result.value) : {};
}

describe("createCheckoutRecorder", () => {
  test("stores the root and the time it was seen", async () => {
    const { record, stored } = setup();

    await record(API, "/work/api");

    expect(stored()).toEqual({
      checkouts: { [API]: { root: "/work/api", seen: T1.toISOString() } },
    });
  });

  test("the most recently seen work tree wins", async () => {
    const { record, file, at } = setup();
    await record(API, "/work/api");
    at(T2);

    await record(API, "/work/api-hotfix");

    expect(roots(file)).toEqual({ [API]: "/work/api-hotfix" });
  });

  test("seeing the work tree on record again does not rewrite the registry", async () => {
    const writes: string[] = [];
    const fs: FileSystem = {
      ...nodeFileSystem,
      writeAtomic: (path, text) => {
        writes.push(path);
        nodeFileSystem.writeAtomic(path, text);
      },
    };
    const { record } = setup(undefined, fs);
    await record(API, "/work/api");

    await record(API, "/work/api");

    expect(writes).toHaveLength(1);
  });

  test("a registry written before checkouts existed loads unchanged and gains the field", async () => {
    const before = { orgs: { "github.com/acme": { owner: "acme" } }, extra: [1] };
    const { record, file, stored } = setup(JSON.stringify(before));
    expect(readCheckouts(nodeFileSystem, file)).toEqual({ ok: true, value: new Map() });

    await record(API, "/work/api");

    expect(stored()).toEqual({
      ...before,
      checkouts: { [API]: { root: "/work/api", seen: T1.toISOString() } },
    });
  });

  test("keeps the other repos' checkouts and the product links", async () => {
    const { record, file } = setup();
    await linkRepos(nodeFileSystem, file, { repos: [API, "github.com/acme/web"], product: "shop" });
    await record("github.com/acme/web", "/work/web");

    await record(API, "/work/api");

    expect(roots(file)).toEqual({ [API]: "/work/api", "github.com/acme/web": "/work/web" });
    expect(readFileSync(file, "utf8")).toContain('"shop"');
  });

  test("leaves a registry that cannot be understood untouched and logs it", async () => {
    const broken = '{"checkouts":{"github.com/acme/api":"/work/api"}}';
    const { record, file, logged } = setup(broken);

    await record(API, "/work/api");

    expect(readFileSync(file, "utf8")).toBe(broken);
    expect(logged).toEqual([{ level: "warn", msg: "checkout not recorded" }]);
  });

  test("logs a registry problem once, however many calls meet it", async () => {
    const { record, logged } = setup('{"checkouts":[]}');

    await record(API, "/work/api");
    await record(API, "/work/api");
    await record("github.com/acme/web", "/work/web");

    expect(logged).toHaveLength(1);
  });

  test("logs a different problem separately", async () => {
    const { record, logged, file } = setup('{"checkouts":[]}');
    await record(API, "/work/api");

    writeFileSync(file, "not json");
    await record(API, "/work/api");

    expect(logged).toHaveLength(2);
  });

  test("logs instead of throwing when the file system fails", async () => {
    const fs: FileSystem = {
      ...nodeFileSystem,
      readText: () => {
        throw new Error("EIO");
      },
    };
    const { record, logged } = setup(undefined, fs);

    await record(API, "/work/api");

    expect(logged).toEqual([{ level: "warn", msg: "checkout not recorded" }]);
  });

  test("logs and skips the write when another process holds the registry lock", async () => {
    const timing: LockTiming = {
      nowMs: (() => {
        let clock = 0;
        return () => (clock += 100);
      })(),
      sleepMs: () => Promise.resolve(),
      retryMs: 1,
      timeoutMs: 100,
      staleMs: 1_000_000,
      uniqueSuffix: () => "x",
    };
    const file = join(tempDir(), "registry.json");
    writeFileSync(`${file}.lock`, "");
    const logged: Logged[] = [];
    const record = createCheckoutRecorder({
      fs: nodeFileSystem,
      registryFile: file,
      now: () => T1,
      log: (level, msg) => {
        logged.push({ level, msg });
      },
      timing,
    });

    await record(API, "/work/api");

    expect(roots(file)).toEqual({});
    expect(logged).toEqual([{ level: "warn", msg: "checkout not recorded" }]);
  });
});

describe("readCheckouts", () => {
  test("a missing registry has no checkouts", () => {
    expect(readCheckouts(nodeFileSystem, join(tempDir(), "registry.json"))).toEqual({
      ok: true,
      value: new Map(),
    });
  });

  test("an entry without a root is reported", () => {
    const file = join(tempDir(), "registry.json");
    writeFileSync(file, `{"checkouts":{"${API}":{"seen":"x"}}}`);

    const result = readCheckouts(nodeFileSystem, file);

    expect(result.ok).toBe(false);
  });

  test("a checkouts field that is not an object is reported", () => {
    const file = join(tempDir(), "registry.json");
    writeFileSync(file, '{"checkouts":[]}');

    expect(readCheckouts(nodeFileSystem, file).ok).toBe(false);
  });
});

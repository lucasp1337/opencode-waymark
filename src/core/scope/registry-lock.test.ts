import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDirs } from "../../../test/temp-dir";
import { err, ok } from "../model/result";
import { type FileSystem, nodeFileSystem as fs } from "../store/fs";
import { linkRepos } from "./products";
import { recordMerge, resolveOrg } from "./registry";
import { type LockTiming, withRegistryLock } from "./registry-lock";

const tempDir = useTempDirs();

const NOW = 1_700_000_000_000;
let suffixes = 0;
const acme = { id: "github.com/acme", owner: "acme" };

// A clock that only moves when someone sleeps, so waiting is instant and deterministic.
function fakeTiming(onSleep: () => void = () => undefined): LockTiming & { sleeps: number } {
  let now = NOW;
  const timing = {
    sleeps: 0,
    nowMs: () => now,
    sleepMs(ms: number) {
      now += ms;
      timing.sleeps += 1;
      onSleep();
      return Promise.resolve();
    },
    retryMs: 10,
    timeoutMs: 100,
    staleMs: 1_000,
    uniqueSuffix: () => `${++suffixes}`,
  };
  return timing;
}

function registryPath(): string {
  return join(tempDir(), "registry.json");
}

function readRegistry(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function holdLock(file: string, ageMs = 0): string {
  const lock = `${file}.lock`;
  writeFileSync(lock, "");
  const seconds = (NOW - ageMs) / 1000;
  utimesSync(lock, seconds, seconds);
  return lock;
}

describe("withRegistryLock", () => {
  test("releases the lock after the update", async () => {
    const file = registryPath();

    const result = await withRegistryLock(fs, file, fakeTiming(), () => ok("done"));

    expect(result).toEqual(ok("done"));
    expect(existsSync(`${file}.lock`)).toBe(false);
  });

  test("releases the lock when the update fails or throws", async () => {
    const file = registryPath();

    await withRegistryLock(fs, file, fakeTiming(), () => err("refused"));
    expect(existsSync(`${file}.lock`)).toBe(false);

    await expect(
      withRegistryLock(fs, file, fakeTiming(), () => {
        throw new Error("disk full");
      }),
    ).rejects.toThrow("disk full");
    expect(existsSync(`${file}.lock`)).toBe(false);
  });

  test("waits for a lock another process releases, then runs", async () => {
    const file = registryPath();
    const lock = holdLock(file);
    const timing = fakeTiming(() => fs.remove(lock));

    const result = await withRegistryLock(fs, file, timing, () => ok("ran"));

    expect(result).toEqual(ok("ran"));
    expect(timing.sleeps).toBe(1);
  });

  test("gives up with a message when the lock stays held, leaving it alone", async () => {
    const file = registryPath();
    const lock = holdLock(file);
    let ran = false;

    const result = await withRegistryLock(fs, file, fakeTiming(), () => {
      ran = true;
      return ok(undefined);
    });

    expect(result).toEqual(
      err(`registry ${file} is being updated by another Waymark process; try again`),
    );
    expect(ran).toBe(false);
    expect(existsSync(lock)).toBe(true);
  });

  test("takes over a lock older than the stale bound and releases it afterwards", async () => {
    const file = registryPath();
    holdLock(file, 5_000);
    const timing = fakeTiming();

    const result = await withRegistryLock(fs, file, timing, () => ok("ran"));

    expect(result).toEqual(ok("ran"));
    expect(timing.sleeps).toBe(0);
    expect(existsSync(`${file}.lock`)).toBe(false);
  });

  test("does not take over a lock younger than the stale bound", async () => {
    const file = registryPath();
    holdLock(file, 500);

    const result = await withRegistryLock(fs, file, fakeTiming(), () => ok("ran"));

    expect(result.ok).toBe(false);
  });
});

describe("stale lock takeover", () => {
  test("a waiter with an outdated staleness check does not break the lock another took over", async () => {
    const file = registryPath();
    const lock = holdLock(file, 5_000);
    const staleSeenByB = fs.mtimeMs(lock);
    let raced = false;
    // B has judged the lock stale; before B acts, A takes it over and holds a fresh lock.
    const racing: FileSystem = {
      ...fs,
      mtimeMs(path) {
        if (path !== lock || raced) {
          return fs.mtimeMs(path);
        }
        raced = true;
        fs.remove(lock);
        holdLock(file);
        return staleSeenByB;
      },
    };
    let ran = false;

    const result = await withRegistryLock(racing, file, fakeTiming(), () => {
      ran = true;
      return ok(undefined);
    });

    expect(ran).toBe(false);
    expect(result.ok).toBe(false);
    expect(existsSync(lock)).toBe(true);
  });

  test("leaves no renamed stale lock behind", async () => {
    const file = registryPath();
    holdLock(file, 5_000);

    await withRegistryLock(fs, file, fakeTiming(), () => ok("ran"));

    expect(readdirSync(tempDir())).toEqual([]);
  });
});

describe("registry writers", () => {
  test("a writer that waited keeps the update another process made meanwhile", async () => {
    const file = registryPath();
    const lock = holdLock(file);
    const timing = fakeTiming(() => {
      fs.writeAtomic(file, JSON.stringify({ products: { storefront: { repos: ["x/web"] } } }));
      fs.remove(lock);
    });

    await linkRepos(fs, file, { repos: ["x/api"], product: "payments" }, timing);

    expect(readRegistry(file)).toEqual({
      products: { storefront: { repos: ["x/web"] }, payments: { repos: ["x/api"] } },
    });
  });

  test("a merge that cannot get the lock reports it and writes nothing", async () => {
    const file = registryPath();
    await resolveOrg(fs, file, acme);
    await resolveOrg(fs, file, { id: "github.com/labs", owner: "labs" });
    const before = readFileSync(file, "utf8");
    holdLock(file);

    const result = await recordMerge(
      fs,
      file,
      { into: acme.id, from: "github.com/labs" },
      fakeTiming(),
    );

    expect(result.ok).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("a new org registered while waiting is not registered twice", async () => {
    const file = registryPath();
    const lock = holdLock(file);
    const timing = fakeTiming(() => {
      fs.writeAtomic(file, JSON.stringify({ orgs: { [acme.id]: { owner: "acme" } } }));
      fs.remove(lock);
    });

    expect(await resolveOrg(fs, file, acme, timing)).toEqual(ok({ id: acme.id, added: false }));
  });

  test("a known org is answered without the lock", async () => {
    const file = registryPath();
    await resolveOrg(fs, file, acme);
    holdLock(file);

    expect(await resolveOrg(fs, file, acme, fakeTiming())).toEqual(
      ok({ id: acme.id, added: false }),
    );
  });
});

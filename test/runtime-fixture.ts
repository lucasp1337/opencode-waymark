import { afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryId } from "../src/core/model/id";
import { createRuntime, type Runtime } from "../src/core/runtime";
import type { Git } from "../src/core/scope/git";
import { nodeFileSystem } from "../src/core/store/fs";
import { createFakeHost, type FakeHost } from "./fake-host";
import { memoryId } from "./memory-id";

const REPO_DIR = "/work/api";
const PLAIN_DIR = "/work/notes";
const SESSION = "ses_repo";
const PLAIN_SESSION = "ses_plain";
// The first id fakeIds hands out; the second ends in 0002, and so on.
export const FIRST_ID = "01JB8Z6Q4R3M2N1P0V9W8X0001";

// A git with one repository, /work/api, whose origin is github.com/acme/api.
const fakeGit: Git = {
  root: (dir) =>
    dir.startsWith(REPO_DIR) ? { status: "found", value: REPO_DIR } : { status: "absent" },
  originUrl: () => ({ status: "found", value: "git@github.com:Acme/api.git" }),
};

interface FakeClock {
  now(): Date;
  advance(ms: number): void;
}

function fakeClock(start = "2026-03-01T10:00:00.000Z"): FakeClock {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
  };
}

function fakeIds(): () => MemoryId {
  let next = 0;
  return () => {
    next += 1;
    return memoryId(`01JB8Z6Q4R3M2N1P0V9W8X${String(next).padStart(4, "0")}`);
  };
}

export interface RuntimeFixture {
  readonly host: FakeHost;
  readonly dataDir: string;
  readonly clock: FakeClock;
  readonly runtime: Runtime;
  // Disposes this activation and starts the next one on the same data dir.
  restart(): RuntimeFixture;
}

interface Activation {
  readonly dataDir: string;
  readonly clock: FakeClock;
  readonly newId: () => MemoryId;
  readonly started: RuntimeFixture[];
}

function start(activation: Activation): RuntimeFixture {
  const host = createFakeHost();
  host.sessions.set(SESSION, { id: SESSION, directory: REPO_DIR });
  host.sessions.set(PLAIN_SESSION, { id: PLAIN_SESSION, directory: PLAIN_DIR });
  const { dataDir, clock, newId } = activation;
  const runtime = createRuntime(host, {
    dataDir,
    fs: nodeFileSystem,
    git: fakeGit,
    now: clock.now,
    newId,
  });
  const fixture: RuntimeFixture = {
    host,
    dataDir,
    clock,
    runtime,
    restart: () => {
      runtime.dispose();
      return start(activation);
    },
  };
  activation.started.push(fixture);
  return fixture;
}

// Runtimes over a fresh temp data dir with a fake clock and fake ids, disposed and deleted after
// each test.
export function useRuntime(): () => RuntimeFixture {
  const started: RuntimeFixture[] = [];
  afterEach(() => {
    for (const fixture of started.splice(0)) {
      fixture.runtime.dispose();
      rmSync(fixture.dataDir, { recursive: true, force: true });
    }
  });
  return () =>
    start({
      dataDir: mkdtempSync(join(tmpdir(), "waymark-runtime-")),
      clock: fakeClock(),
      newId: fakeIds(),
      started,
    });
}

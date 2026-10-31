import { afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryId } from "../src/core/model/id";
import type { Capabilities } from "../src/core/port";
import { createRuntime, type Runtime } from "../src/core/runtime";
import type { Git } from "../src/core/scope/git";
import type { Embedder } from "../src/core/store/embedder";
import { createFakeHost, type FakeHost } from "./fake-host";
import { fakeRepos } from "./fake-repos";
import { memoryId } from "./memory-id";

const REPO_DIR = "/work/api";
const WEB_DIR = "/work/web";
const PLAIN_DIR = "/work/notes";
export const SESSION = "ses_repo";
export const WEB_SESSION = "ses_web";
export const PLAIN_SESSION = "ses_plain";
// The first id fakeIds hands out; the second ends in 0002, and so on.
export const FIRST_ID = "01JB8Z6Q4R3M2N1P0V9W8X0001";

const ORIGINS = new Map([
  [REPO_DIR, "git@github.com:Acme/api.git"],
  [WEB_DIR, "git@github.com:acme/web.git"],
]);

// Two repositories: /work/api (github.com/acme/api) and /work/web (github.com/acme/web).
const fakeGit: Git = {
  root: (dir) => {
    const root = [...ORIGINS.keys()].find((repo) => dir === repo || dir.startsWith(`${repo}/`));
    return root === undefined ? { status: "absent" } : { status: "found", value: root };
  },
  originUrl: (root) => {
    const origin = ORIGINS.get(root);
    return origin === undefined ? { status: "absent" } : { status: "found", value: origin };
  },
};

const repos = fakeRepos(ORIGINS);

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
  readonly setup: RuntimeSetup;
}

interface RuntimeSetup {
  // Plugin options, as the user's opencode config would pass them.
  readonly options?: unknown;
  readonly capabilities?: Capabilities;
  // Without one the model never finishes loading, so retrieval is by words only.
  readonly embedder?: Embedder;
}

function embedderFor(setup: RuntimeSetup): Promise<Embedder> {
  return setup.embedder === undefined
    ? new Promise(() => undefined)
    : Promise.resolve(setup.embedder);
}

function start(activation: Activation): RuntimeFixture {
  const host = createFakeHost(activation.setup.capabilities);
  host.sessions.set(SESSION, { id: SESSION, directory: REPO_DIR });
  host.sessions.set(WEB_SESSION, { id: WEB_SESSION, directory: WEB_DIR });
  host.sessions.set(PLAIN_SESSION, { id: PLAIN_SESSION, directory: PLAIN_DIR });
  const { dataDir, clock, newId } = activation;
  const runtime = createRuntime(host, {
    dataDir,
    fs: repos.fs,
    git: fakeGit,
    originUrl: repos.originUrl,
    now: clock.now,
    newId,
    options: activation.setup.options,
    loadEmbedder: () => embedderFor(activation.setup),
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
export function useRuntime(setup: RuntimeSetup = {}): () => RuntimeFixture {
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
      setup,
    });
}

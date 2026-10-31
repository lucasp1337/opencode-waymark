import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createFakeHost } from "../../../../test/fake-host";
import { fakeRepos } from "../../../../test/fake-repos";
import { useTempDirs } from "../../../../test/temp-dir";
import type { ToolCallInfo } from "../../port";
import { declinePair, linkRepos } from "../../scope/products";
import { type FileSystem, nodeFileSystem } from "../../store/fs";
import type { RecallScope } from "../recall/recall-scope";
import { createSecondRepoHints } from "./second-repo";

const tempDir = useTempDirs();

const API = "github.com/acme/api";
const WEB = "github.com/acme/web";
const DOCS = "github.com/acme/docs";
const SESSION = "ses_a";

const ORIGINS: ReadonlyMap<string, string> = new Map([
  ["/work/api", "git@github.com:acme/api.git"],
  ["/work/web", "git@github.com:acme/web.git"],
  ["/work/docs", "git@github.com:acme/docs.git"],
]);

function scopeIn(directory: string, repo: string): RecallScope {
  return {
    chain: [
      { level: "user" },
      { level: "org", id: "github.com/acme" },
      { level: "repo", id: repo },
    ],
    directory,
  };
}

const SESSION_SCOPE = scopeIn("/work/api", API);

function registryFile(): string {
  return join(tempDir(), "registry.json");
}

interface SetupOptions {
  // null: the session gets no recall.
  readonly scope?: RecallScope | null;
  readonly origins?: ReadonlyMap<string, string>;
  readonly broken?: string[];
  readonly held?: Array<() => void>;
  readonly rejecting?: boolean;
  readonly fs?: Partial<FileSystem>;
  readonly registry?: string;
}

function setup(options: SetupOptions = {}) {
  const host = createFakeHost();
  const repos = fakeRepos(options.origins ?? ORIGINS, {
    ...(options.broken && { broken: options.broken }),
    ...(options.held && { held: options.held }),
    ...(options.rejecting && { rejecting: options.rejecting }),
  });
  const scope = options.scope === undefined ? SESSION_SCOPE : options.scope;
  const hints = createSecondRepoHints({
    recallScope: () => Promise.resolve(scope),
    originUrl: repos.originUrl,
    fs: { ...repos.fs, ...options.fs },
    registryFile: options.registry ?? registryFile(),
    log: host.log,
  });
  return { hints, repos, logs: host.logs };
}

function call(
  paths: readonly string[],
  options: { sessionID?: string; appendable?: boolean } = {},
): ToolCallInfo {
  return {
    sessionID: options.sessionID ?? SESSION,
    tool: "edit",
    args: {},
    touchedPaths: [...paths],
    appendable: options.appendable ?? true,
  };
}

// A repo's origin is looked up off the tool call's path, so the hint rides on the call after the
// first into it. This makes that call and returns the hint, whichever call carried it.
async function touching(
  hints: ReturnType<typeof setup>["hints"],
  paths: readonly string[],
  options: { sessionID?: string; appendable?: boolean } = {},
): Promise<string | null> {
  const first = await hints.onToolAfter(call(paths, options));
  await settled();
  const second = await hints.onToolAfter(call([], options));
  return first ?? second;
}

async function settled(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function touchedRepoLine(repo: string): string {
  return `this call touched another repo, ${repo}.`;
}

describe("second repo hint", () => {
  test("touching a file in another repo appends one hint naming both repos", async () => {
    const { hints } = setup();

    expect(await touching(hints, ["/work/web/src/main.ts"])).toBe(
      [
        "waymark · this session's repo is github.com/acme/api; this call touched another repo, github.com/acme/web.",
        "Ask the user, in your own words, whether both repos belong to one product, so memories saved to the product apply in both.",
        'Record the answer: yes: memory_link with repos ["github.com/acme/api", "github.com/acme/web"] and product set to the name the user chooses; no: memory_link with the same repos and decline true, and waymark will not ask again.',
      ].join("\n"),
    );
  });

  test("a second call into the same other repo in the same session adds nothing", async () => {
    const { hints } = setup();
    await touching(hints, ["/work/web/src/main.ts"]);

    expect(await touching(hints, ["/work/web/src/other.ts"])).toBeNull();
  });

  test("a new session is hinted about the same repo again", async () => {
    const { hints } = setup();
    await touching(hints, ["/work/web/src/main.ts"]);

    expect(await touching(hints, ["/work/web/src/main.ts"], { sessionID: "ses_b" })).toContain(
      touchedRepoLine(WEB),
    );
  });

  test("after forget the same session is hinted again", async () => {
    const { hints } = setup();
    await touching(hints, ["/work/web/src/main.ts"]);

    hints.forget(SESSION);

    expect(await touching(hints, ["/work/web/src/main.ts"])).toContain(touchedRepoLine(WEB));
  });

  test("paths in the session's own repo add nothing", async () => {
    const { hints } = setup();

    expect(await touching(hints, ["/work/api/src/main.ts", "/work/api"])).toBeNull();
  });

  test("a path outside any repo adds nothing", async () => {
    const { hints } = setup();

    expect(await touching(hints, ["/tmp/notes.md"])).toBeNull();
  });

  test("a relative path resolves against the session directory", async () => {
    const { hints } = setup();

    expect(await touching(hints, ["../web/src/main.ts"])).toContain(touchedRepoLine(WEB));
  });

  test("a directory that is another repo's root is detected", async () => {
    const base = tempDir();
    mkdirSync(join(base, "web"));
    const origins = new Map([
      [join(base, "api"), "git@github.com:acme/api.git"],
      [join(base, "web"), "git@github.com:acme/web.git"],
    ]);
    const { hints } = setup({ origins, scope: scopeIn(join(base, "api"), API) });

    expect(await touching(hints, [join(base, "web")])).toContain(touchedRepoLine(WEB));
  });

  test("two other repos in one call give both hints in one output", async () => {
    const { hints } = setup();

    const text = await touching(hints, ["/work/web/a.ts", "/work/docs/b.md"]);

    const [first, second, ...rest] = text?.split("\n\n") ?? [];
    expect(first).toContain(touchedRepoLine(WEB));
    expect(second).toContain(touchedRepoLine(DOCS));
    expect(rest).toEqual([]);
  });

  test("each delivered hint is logged with the session and both repos", async () => {
    const { hints, logs } = setup();

    await touching(hints, ["/work/web/a.ts"]);

    expect(logs).toEqual([
      {
        level: "info",
        msg: "product hint",
        data: { sessionID: SESSION, repo: API, other: WEB },
      },
    ]);
  });
});

describe("second repo hint and the registry", () => {
  test("a declined pair is never hinted, in any session", async () => {
    const registry = registryFile();
    declinePair(nodeFileSystem, registry, [API, WEB]);
    const { hints } = setup({ registry });

    expect(await touching(hints, ["/work/web/a.ts"])).toBeNull();
    expect(await touching(hints, ["/work/web/a.ts"], { sessionID: "ses_b" })).toBeNull();
  });

  test("a linked pair adds nothing", async () => {
    const registry = registryFile();
    linkRepos(nodeFileSystem, registry, { repos: [API, WEB], product: "payments" });
    const { hints } = setup({ registry });

    expect(await touching(hints, ["/work/web/a.ts"])).toBeNull();
  });

  test("repos in two different products add nothing", async () => {
    const registry = registryFile();
    linkRepos(nodeFileSystem, registry, { repos: [API], product: "payments" });
    linkRepos(nodeFileSystem, registry, { repos: [WEB], product: "storefront" });
    const { hints } = setup({ registry });

    expect(await touching(hints, ["/work/web/a.ts"])).toBeNull();
  });

  test.each([
    ["the session's repo", API],
    ["the other repo", WEB],
  ])("when %s is in a product the hint says both are then in it", async (_, member) => {
    const registry = registryFile();
    linkRepos(nodeFileSystem, registry, { repos: [member], product: "payments" });
    const { hints } = setup({ registry });

    const text = await touching(hints, ["/work/web/a.ts"]);

    expect(text).toContain(
      `yes: memory_link with repos ["${API}", "${WEB}"]; both are then in product payments;`,
    );
  });

  test("an unreadable registry adds nothing, is logged, and a later call tries again", async () => {
    let readable = false;
    const fs: Partial<FileSystem> = {
      readText(path) {
        if (!readable) {
          throw new Error("EACCES");
        }
        return nodeFileSystem.readText(path);
      },
    };
    const { hints, logs } = setup({ fs });

    expect(await touching(hints, ["/work/web/a.ts"])).toBeNull();
    readable = true;

    expect(await touching(hints, ["/work/web/a.ts"])).toContain(touchedRepoLine(WEB));
    expect(logs).toEqual([
      {
        level: "warn",
        msg: "product links not read",
        data: { repo: WEB, error: "Error: EACCES" },
      },
      { level: "info", msg: "product hint", data: { sessionID: SESSION, repo: API, other: WEB } },
    ]);
  });

  test("an invalid registry adds nothing and a later call tries again", async () => {
    const registry = registryFile();
    nodeFileSystem.writeAtomic(registry, "{not json");
    const { hints, logs } = setup({ registry });

    expect(await touching(hints, ["/work/web/a.ts"])).toBeNull();
    nodeFileSystem.writeAtomic(registry, "{}");

    expect(await touching(hints, ["/work/web/a.ts"])).toContain(touchedRepoLine(WEB));
    expect(logs.filter((entry) => entry.level === "warn")).toEqual([
      {
        level: "warn",
        msg: "product links not read",
        data: { repo: WEB, error: `registry ${registry} is not valid JSON` },
      },
    ]);
  });
});

describe("second repo hint delivery", () => {
  test("two paths of one other repo in one call give one hint", async () => {
    const { hints } = setup();

    const hint = await touching(hints, ["/work/web/a.ts", "/work/web/src/b.ts"]);

    expect(hint?.split(touchedRepoLine(WEB))).toHaveLength(2);
  });

  test("parallel calls of a session into the other repo give one hint", async () => {
    const { hints } = setup();

    const outputs = await Promise.all([
      touching(hints, ["/work/web/a.ts"]),
      touching(hints, ["/work/web/b.ts"]),
    ]);

    expect(outputs.join("\n").split(touchedRepoLine(WEB))).toHaveLength(2);
  });

  test("a call that cannot carry text keeps the hint for the next one, which delivers it once", async () => {
    const { hints } = setup();

    expect(await touching(hints, ["/work/web/a.ts"], { appendable: false })).toBeNull();
    const delivered = await touching(hints, []);
    const repeated = await touching(hints, []);

    expect(delivered).toContain(touchedRepoLine(WEB));
    expect(repeated).toBeNull();
  });

  test("a hint kept for a session is not delivered to another session", async () => {
    const { hints } = setup();
    await touching(hints, ["/work/web/a.ts"], { appendable: false });

    expect(await touching(hints, [], { sessionID: "ses_b" })).toBeNull();
  });
});

describe("second repo hint without a repo to compare", () => {
  test("a session without recall adds nothing and asks git nothing", async () => {
    const { hints, repos } = setup({ scope: null });

    expect(await touching(hints, ["/work/web/a.ts"])).toBeNull();
    expect(repos.originAsks).toEqual([]);
  });

  test("a session outside a repo adds nothing and asks git nothing", async () => {
    const { hints, repos } = setup({ scope: { chain: [{ level: "user" }], directory: "/work" } });

    expect(await touching(hints, ["/work/web/a.ts"])).toBeNull();
    expect(repos.originAsks).toEqual([]);
  });
});

describe("second repo hint and git", () => {
  test("the call that first touches another repo is not held up and carries no hint", async () => {
    const { hints } = setup();

    expect(await hints.onToolAfter(call(["/work/web/a.ts"]))).toBeNull();
  });

  test("a hint waits for the origin lookup and comes with the next call", async () => {
    const held: Array<() => void> = [];
    const { hints } = setup({ held });
    expect(await hints.onToolAfter(call(["/work/web/a.ts"]))).toBeNull();
    expect(await hints.onToolAfter(call([]))).toBeNull();
    for (const release of held.splice(0)) {
      release();
    }
    await settled();

    expect(await hints.onToolAfter(call([]))).toContain(touchedRepoLine(WEB));
  });

  test("a directory git cannot answer for adds nothing and is logged on each attempt, three at most", async () => {
    const { hints, repos, logs } = setup({ broken: ["/work/web"] });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await touching(hints, ["/work/web/a.ts"])).toBeNull();
    }

    expect(repos.originAsks).toEqual(["/work/web", "/work/web", "/work/web"]);
    expect(logs).toHaveLength(3);
    expect(logs[0]).toEqual({
      level: "warn",
      msg: "repo of a touched path not resolved",
      data: { root: "/work/web", failure: "git did not answer" },
    });
  });

  test("a lookup that throws is a failed lookup, logged, and never reaches the tool call", async () => {
    const { hints, logs } = setup({ rejecting: true });

    expect(await touching(hints, ["/work/web/a.ts"])).toBeNull();
    expect(logs[0]).toEqual({
      level: "warn",
      msg: "repo of a touched path not resolved",
      data: { root: "/work/web", failure: "Error: spawn failed" },
    });
  });

  test("a repo created after a failed lookup is seen on a later attempt", async () => {
    const broken = ["/work/web"];
    const { hints } = setup({ broken });
    expect(await touching(hints, ["/work/web/a.ts"])).toBeNull();
    broken.splice(0);

    expect(await touching(hints, ["/work/web/a.ts"])).toContain(touchedRepoLine(WEB));
  });

  test("a session ending gives roots whose lookups gave up another chance", async () => {
    const broken = ["/work/web"];
    const { hints } = setup({ broken });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await touching(hints, ["/work/web/a.ts"]);
    }
    broken.splice(0);
    hints.forget(SESSION);

    expect(await touching(hints, ["/work/web/a.ts"])).toContain(touchedRepoLine(WEB));
  });

  test("the origin is asked once per repo root, not per directory or session", async () => {
    const { hints, repos } = setup();

    await touching(hints, ["/work/web/src/a.ts"]);
    await touching(hints, ["/work/web/src/b.ts", "/work/web/lib/c.ts"], { sessionID: "ses_b" });

    expect(repos.originAsks).toEqual(["/work/web"]);
  });

  test("a path that cannot be examined is logged and skipped, the call's other paths still count", async () => {
    const fs: Partial<FileSystem> = {
      isDirectory(path) {
        if (path === "/work/locked") {
          throw new Error("EACCES");
        }
        return nodeFileSystem.isDirectory(path);
      },
    };
    const { hints, logs } = setup({ fs });

    const text = await touching(hints, ["/work/locked", "/work/web/a.ts"]);

    expect(text).toContain(touchedRepoLine(WEB));
    expect(logs[0]).toEqual({
      level: "warn",
      msg: "touched path not examined",
      data: { path: "/work/locked", error: "Error: EACCES" },
    });
  });
});

import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createFakeHost } from "../../../../test/fake-host";
import { useTempDirs } from "../../../../test/temp-dir";
import type { ToolCallInfo } from "../../port";
import type { Git } from "../../scope/git";
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

function within(dir: string, root: string): boolean {
  return dir === root || dir.startsWith(`${root}/`);
}

// A git whose repositories are the roots in `origins`; directories under `broken` never answer.
function fakeGit(origins: ReadonlyMap<string, string>, broken: readonly string[]) {
  const rootAsks: string[] = [];
  const originAsks: string[] = [];
  const git: Git = {
    root(dir) {
      rootAsks.push(dir);
      if (broken.some((prefix) => within(dir, prefix))) {
        return { status: "failed", reason: "git did not answer" };
      }
      const root = [...origins.keys()].find((candidate) => within(dir, candidate));
      return root === undefined ? { status: "absent" } : { status: "found", value: root };
    },
    originUrl(root) {
      originAsks.push(root);
      const origin = origins.get(root);
      return origin === undefined ? { status: "absent" } : { status: "found", value: origin };
    },
  };
  return { git, rootAsks, originAsks };
}

function registryFile(): string {
  return join(tempDir(), "registry.json");
}

interface SetupOptions {
  // null: the session gets no recall.
  readonly scope?: RecallScope | null;
  readonly origins?: ReadonlyMap<string, string>;
  readonly broken?: readonly string[];
  readonly fs?: FileSystem;
  readonly registry?: string;
}

function setup(options: SetupOptions = {}) {
  const host = createFakeHost();
  const git = fakeGit(options.origins ?? ORIGINS, options.broken ?? []);
  const scope = options.scope === undefined ? SESSION_SCOPE : options.scope;
  const hints = createSecondRepoHints({
    recallScope: () => Promise.resolve(scope),
    git: git.git,
    fs: options.fs ?? nodeFileSystem,
    registryFile: options.registry ?? registryFile(),
    log: host.log,
  });
  return { hints, git, logs: host.logs };
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

function touchedRepoLine(repo: string): string {
  return `this call touched another repo, ${repo}.`;
}

describe("second repo hint", () => {
  test("touching a file in another repo appends one hint naming both repos", async () => {
    const { hints } = setup();

    expect(await hints.onToolAfter(call(["/work/web/src/main.ts"]))).toBe(
      [
        "waymark · this session's repo is github.com/acme/api; this call touched another repo, github.com/acme/web.",
        "Ask the user, in your own words, whether both repos belong to one product, so memories saved to the product apply in both.",
        'Record the answer: yes: memory_link with repos ["github.com/acme/api", "github.com/acme/web"] and product set to the name the user chooses; no: memory_link with the same repos and decline true, and waymark will not ask again.',
      ].join("\n"),
    );
  });

  test("a second call into the same other repo in the same session adds nothing", async () => {
    const { hints } = setup();
    await hints.onToolAfter(call(["/work/web/src/main.ts"]));

    expect(await hints.onToolAfter(call(["/work/web/src/other.ts"]))).toBeNull();
  });

  test("a new session is hinted about the same repo again", async () => {
    const { hints } = setup();
    await hints.onToolAfter(call(["/work/web/src/main.ts"]));

    expect(
      await hints.onToolAfter(call(["/work/web/src/main.ts"], { sessionID: "ses_b" })),
    ).toContain(touchedRepoLine(WEB));
  });

  test("after forget the same session is hinted again", async () => {
    const { hints } = setup();
    await hints.onToolAfter(call(["/work/web/src/main.ts"]));

    hints.forget(SESSION);

    expect(await hints.onToolAfter(call(["/work/web/src/main.ts"]))).toContain(
      touchedRepoLine(WEB),
    );
  });

  test("paths in the session's own repo add nothing", async () => {
    const { hints } = setup();

    expect(await hints.onToolAfter(call(["/work/api/src/main.ts", "/work/api"]))).toBeNull();
  });

  test("a path outside any repo adds nothing", async () => {
    const { hints } = setup();

    expect(await hints.onToolAfter(call(["/tmp/notes.md"]))).toBeNull();
  });

  test("a relative path resolves against the session directory", async () => {
    const { hints } = setup();

    expect(await hints.onToolAfter(call(["../web/src/main.ts"]))).toContain(touchedRepoLine(WEB));
  });

  test("a directory that is another repo's root is detected", async () => {
    const base = tempDir();
    mkdirSync(join(base, "web"));
    const origins = new Map([
      [join(base, "api"), "git@github.com:acme/api.git"],
      [join(base, "web"), "git@github.com:acme/web.git"],
    ]);
    const { hints } = setup({ origins, scope: scopeIn(join(base, "api"), API) });

    expect(await hints.onToolAfter(call([join(base, "web")]))).toContain(touchedRepoLine(WEB));
  });

  test("two other repos in one call give both hints in one output", async () => {
    const { hints } = setup();

    const text = await hints.onToolAfter(call(["/work/web/a.ts", "/work/docs/b.md"]));

    const [first, second, ...rest] = text?.split("\n\n") ?? [];
    expect(first).toContain(touchedRepoLine(WEB));
    expect(second).toContain(touchedRepoLine(DOCS));
    expect(rest).toEqual([]);
  });

  test("each delivered hint is logged with the session and both repos", async () => {
    const { hints, logs } = setup();

    await hints.onToolAfter(call(["/work/web/a.ts"]));

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

    expect(await hints.onToolAfter(call(["/work/web/a.ts"]))).toBeNull();
    expect(await hints.onToolAfter(call(["/work/web/a.ts"], { sessionID: "ses_b" }))).toBeNull();
  });

  test("a linked pair adds nothing", async () => {
    const registry = registryFile();
    linkRepos(nodeFileSystem, registry, { repos: [API, WEB], product: "payments" });
    const { hints } = setup({ registry });

    expect(await hints.onToolAfter(call(["/work/web/a.ts"]))).toBeNull();
  });

  test("repos in two different products add nothing", async () => {
    const registry = registryFile();
    linkRepos(nodeFileSystem, registry, { repos: [API], product: "payments" });
    linkRepos(nodeFileSystem, registry, { repos: [WEB], product: "storefront" });
    const { hints } = setup({ registry });

    expect(await hints.onToolAfter(call(["/work/web/a.ts"]))).toBeNull();
  });

  test.each([
    ["the session's repo", API],
    ["the other repo", WEB],
  ])("when %s is in a product the hint says both are then in it", async (_, member) => {
    const registry = registryFile();
    linkRepos(nodeFileSystem, registry, { repos: [member], product: "payments" });
    const { hints } = setup({ registry });

    const text = await hints.onToolAfter(call(["/work/web/a.ts"]));

    expect(text).toContain(
      `yes: memory_link with repos ["${API}", "${WEB}"]; both are then in product payments;`,
    );
  });

  test("an unreadable registry adds nothing, is logged, and a later call tries again", async () => {
    let readable = false;
    const fs: FileSystem = {
      ...nodeFileSystem,
      readText(path) {
        if (!readable) {
          throw new Error("EACCES");
        }
        return nodeFileSystem.readText(path);
      },
    };
    const { hints, logs } = setup({ fs });

    expect(await hints.onToolAfter(call(["/work/web/a.ts"]))).toBeNull();
    readable = true;

    expect(await hints.onToolAfter(call(["/work/web/a.ts"]))).toContain(touchedRepoLine(WEB));
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

    expect(await hints.onToolAfter(call(["/work/web/a.ts"]))).toBeNull();
    nodeFileSystem.writeAtomic(registry, "{}");

    expect(await hints.onToolAfter(call(["/work/web/a.ts"]))).toContain(touchedRepoLine(WEB));
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

    const hint = await hints.onToolAfter(call(["/work/web/a.ts", "/work/web/src/b.ts"]));

    expect(hint?.split(touchedRepoLine(WEB))).toHaveLength(2);
  });

  test("parallel calls of a session into the other repo give one hint", async () => {
    const { hints } = setup();

    const outputs = await Promise.all([
      hints.onToolAfter(call(["/work/web/a.ts"])),
      hints.onToolAfter(call(["/work/web/b.ts"])),
    ]);

    expect(outputs.join("\n").split(touchedRepoLine(WEB))).toHaveLength(2);
  });

  test("a call that cannot carry text keeps the hint for the next one, which delivers it once", async () => {
    const { hints } = setup();

    expect(await hints.onToolAfter(call(["/work/web/a.ts"], { appendable: false }))).toBeNull();
    const delivered = await hints.onToolAfter(call([]));
    const repeated = await hints.onToolAfter(call([]));

    expect(delivered).toContain(touchedRepoLine(WEB));
    expect(repeated).toBeNull();
  });

  test("a hint kept for a session is not delivered to another session", async () => {
    const { hints } = setup();
    await hints.onToolAfter(call(["/work/web/a.ts"], { appendable: false }));

    expect(await hints.onToolAfter(call([], { sessionID: "ses_b" }))).toBeNull();
  });
});

describe("second repo hint without a repo to compare", () => {
  test("a session without recall adds nothing and asks git nothing", async () => {
    const { hints, git } = setup({ scope: null });

    expect(await hints.onToolAfter(call(["/work/web/a.ts"]))).toBeNull();
    expect(git.rootAsks).toEqual([]);
  });

  test("a session outside a repo adds nothing and asks git nothing", async () => {
    const { hints, git } = setup({ scope: { chain: [{ level: "user" }], directory: "/work" } });

    expect(await hints.onToolAfter(call(["/work/web/a.ts"]))).toBeNull();
    expect(git.rootAsks).toEqual([]);
  });
});

describe("second repo hint and git", () => {
  test("a directory git cannot answer for adds nothing, is logged once and is not asked again", async () => {
    const { hints, git, logs } = setup({ broken: ["/work/broken"] });

    expect(await hints.onToolAfter(call(["/work/broken/a.ts"]))).toBeNull();
    expect(await hints.onToolAfter(call(["/work/broken/b.ts"]))).toBeNull();

    expect(git.rootAsks).toEqual(["/work/broken"]);
    expect(logs).toEqual([
      {
        level: "warn",
        msg: "repo of a touched path not resolved",
        data: { directory: "/work/broken", failure: "git did not answer" },
      },
    ]);
  });

  test("git is asked once per directory and the origin once per repo root", async () => {
    const { hints, git } = setup();

    await hints.onToolAfter(call(["/work/web/src/a.ts"]));
    await hints.onToolAfter(
      call(["/work/web/src/b.ts", "/work/web/lib/c.ts"], { sessionID: "ses_b" }),
    );

    expect(git.rootAsks).toEqual(["/work/web/src", "/work/web/lib"]);
    expect(git.originAsks).toEqual(["/work/web"]);
  });

  test("a path that cannot be examined is logged and skipped, the call's other paths still count", async () => {
    const fs: FileSystem = {
      ...nodeFileSystem,
      isDirectory(path) {
        if (path === "/work/locked") {
          throw new Error("EACCES");
        }
        return nodeFileSystem.isDirectory(path);
      },
    };
    const { hints, logs } = setup({ fs });

    const text = await hints.onToolAfter(call(["/work/locked", "/work/web/a.ts"]));

    expect(text).toContain(touchedRepoLine(WEB));
    expect(logs[0]).toEqual({
      level: "warn",
      msg: "touched path not examined",
      data: { path: "/work/locked", error: "Error: EACCES" },
    });
  });
});

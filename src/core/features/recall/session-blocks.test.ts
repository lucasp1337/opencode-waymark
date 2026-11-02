import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { memoryId } from "../../../../test/memory-id";
import { useTempDirs } from "../../../../test/temp-dir";
import { validContent } from "../../../../test/valid-content";
import type { MemoryId } from "../../model/id";
import { type Memory, newMemory } from "../../model/memory";
import type { ScopeChain } from "../../model/scope";
import type { LogLevel } from "../../port";
import { createCheckoutRecorder } from "../../scope/checkouts";
import { linkRepos } from "../../scope/products";
import { type FileSystem, nodeFileSystem } from "../../store/fs";
import { type MemoryStats, type Telemetry, UNSEEN } from "../../telemetry/telemetry";
import type { RecallScope } from "./recall-scope";
import { createSessionBlocks } from "./session-blocks";

const INSTRUCTIONS = "Instructions for the agent.";
const CHAIN: ScopeChain = [{ level: "user" }];
// A registry file that does not exist reads as empty.
const NO_REGISTRY = {
  fs: nodeFileSystem,
  registryFile: "/nonexistent/registry.json",
  home: "/home/lucas",
};

function rule(id: string, title: string, supersedes?: string): Memory {
  return newMemory(validContent({ kind: "rule", title, body: "", why: "w" }), {
    id: memoryId(id),
    scope: { level: "user" },
    now: new Date(0),
    ...(supersedes === undefined ? {} : { supersedes: memoryId(supersedes) }),
  });
}

interface Logged {
  readonly level: LogLevel;
  readonly msg: string;
  readonly data: unknown;
}

function fact(id: string, title: string): Memory {
  return newMemory(validContent({ kind: "fact", title, body: "b" }), {
    id: memoryId(id),
    scope: { level: "user" },
    now: new Date(0),
  });
}

const NOW = new Date("2026-06-01T00:00:00.000Z");

// Counters that answer `stats` from `known` and remember the sessions recorded.
function fakeCounters(known: ReadonlyMap<MemoryId, MemoryStats> = new Map()) {
  const recorded: MemoryId[][] = [];
  const counters: Pick<Telemetry, "stats" | "recordSessions"> = {
    stats: (ids) => new Map(ids.map((id) => [id, known.get(id) ?? UNSEEN])),
    recordSessions: (ids) => {
      recorded.push([...ids]);
    },
  };
  return { counters, recorded };
}

function blocksOver(
  stored: Memory[],
  scope: RecallScope | null = { chain: CHAIN, directory: "/d" },
  logged: Logged[] = [],
  counters: Pick<Telemetry, "stats" | "recordSessions"> = fakeCounters().counters,
) {
  return createSessionBlocks({
    store: { inScopes: () => stored },
    ...NO_REGISTRY,
    instructions: INSTRUCTIONS,
    recallScope: () => Promise.resolve(scope),
    indexLines: () => 40,
    indexExit: () => ({ sessions: 20, days: 30 }),
    counters,
    now: () => NOW,
    log: (level, msg, data) => {
      logged.push({ level, msg, data });
    },
  });
}

describe("createSessionBlocks", () => {
  test("renders the session's active memories", async () => {
    const block = await blocksOver([rule("01JB8Z6Q4R3M2N1P0V9W8X0001", "Use UTC")]).blockFor("s");

    expect(block).toContain("- Use UTC");
  });

  test("returns the first rendering again even after new memories appear", async () => {
    const stored = [rule("01JB8Z6Q4R3M2N1P0V9W8X0001", "Use UTC")];
    const blocks = blocksOver(stored);
    const first = await blocks.blockFor("s");

    stored.push(rule("01JB8Z6Q4R3M2N1P0V9W8X0002", "Added later"));

    expect(await blocks.blockFor("s")).toBe(first);
  });

  test("leaves out a superseded rule", async () => {
    const block = await blocksOver([
      rule("01JB8Z6Q4R3M2N1P0V9W8X0001", "Old rule"),
      rule("01JB8Z6Q4R3M2N1P0V9W8X0002", "New rule", "01JB8Z6Q4R3M2N1P0V9W8X0001"),
    ]).blockFor("s");

    expect(block).not.toContain("Old rule");
    expect(block).toContain("New rule");
  });

  test("gives a session without recall nothing", async () => {
    expect(await blocksOver([], null).blockFor("s")).toBeNull();
  });

  test("an empty store still gives the instructions", async () => {
    expect(await blocksOver([]).blockFor("s")).toStartWith(INSTRUCTIONS);
  });

  test("logs the memories each session block shows", async () => {
    const logged: Logged[] = [];

    await blocksOver([rule("01JB8Z6Q4R3M2N1P0V9W8X0001", "Use UTC")], undefined, logged).blockFor(
      "ses_a",
    );

    expect(logged).toEqual([
      {
        level: "info",
        msg: "session block rendered",
        data: { sessionID: "ses_a", memories: ["01JB8Z6Q4R3M2N1P0V9W8X0001"] },
      },
    ]);
  });

  test("logs a session that gets no recall", async () => {
    const logged: Logged[] = [];

    await blocksOver([], null, logged).blockFor("ses_sub");

    expect(logged).toEqual([
      { level: "info", msg: "no recall for session", data: { sessionID: "ses_sub" } },
    ]);
  });
});

describe("createSessionBlocks index usage", () => {
  const FIRST = "01JB8Z6Q4R3M2N1P0V9W8X0001";
  const SECOND = "01JB8Z6Q4R3M2N1P0V9W8X0002";

  test("leaves a fact that was idle for 20 sessions and 30 days out of the index", async () => {
    const idle = fact(FIRST, "Idle fact");
    const { counters } = fakeCounters(new Map([[idle.id, { ...UNSEEN, sessionsSinceRead: 20 }]]));

    const block = await blocksOver(
      [idle, fact(SECOND, "Fresh fact")],
      undefined,
      [],
      counters,
    ).blockFor("s");

    expect(block).not.toContain("Idle fact");
    expect(block).toContain("Fresh fact");
  });

  test("records one in-scope session for each fact and decision it considered", async () => {
    const { counters, recorded } = fakeCounters();
    const stored = [fact(FIRST, "A fact"), rule(SECOND, "A rule")];

    await blocksOver(stored, undefined, [], counters).blockFor("s");

    expect(recorded).toEqual([[memoryId(FIRST)]]);
  });

  test("records the session of a fact that has already left the index", async () => {
    const idle = fact(FIRST, "Idle fact");
    const { counters, recorded } = fakeCounters(
      new Map([[idle.id, { ...UNSEEN, sessionsSinceRead: 20 }]]),
    );

    await blocksOver([idle], undefined, [], counters).blockFor("s");

    expect(recorded).toEqual([[memoryId(FIRST)]]);
  });

  test("records the session once, however often the block is asked for", async () => {
    const { counters, recorded } = fakeCounters();
    const blocks = blocksOver([fact(FIRST, "A fact")], undefined, [], counters);

    await blocks.blockFor("s");
    await blocks.blockFor("s");

    expect(recorded).toHaveLength(1);
  });

  test("records nothing for a session that gets no recall", async () => {
    const { counters, recorded } = fakeCounters();

    await blocksOver([fact(FIRST, "A fact")], null, [], counters).blockFor("s");

    expect(recorded).toEqual([]);
  });

  test("does not record a superseded fact", async () => {
    const { counters, recorded } = fakeCounters();
    const older = fact(FIRST, "Old fact");
    const newer = { ...fact(SECOND, "New fact"), supersedes: older.id };

    await blocksOver([older, newer], undefined, [], counters).blockFor("s");

    expect(recorded).toEqual([[memoryId(SECOND)]]);
  });
});

describe("createSessionBlocks settings", () => {
  const stored = [
    fact("01JB8Z6Q4R3M2N1P0V9W8X0001", "First fact"),
    fact("01JB8Z6Q4R3M2N1P0V9W8X0002", "Second fact"),
  ];

  function blocksWith(settings: { indexLines: number; exitSessions: number }) {
    return createSessionBlocks({
      instructions: INSTRUCTIONS,
      store: { inScopes: () => stored },
      ...NO_REGISTRY,
      recallScope: () => Promise.resolve({ chain: CHAIN, directory: "/d" }),
      indexLines: () => settings.indexLines,
      indexExit: () => ({ sessions: settings.exitSessions, days: 30 }),
      counters: fakeCounters(
        new Map(stored.map((memory) => [memory.id, { ...UNSEEN, sessionsSinceRead: 5 }])),
      ).counters,
      now: () => NOW,
      log: () => undefined,
    });
  }

  test("applies a changed index size to the next session without a new activation", async () => {
    const settings = { indexLines: 2, exitSessions: 20 };
    const blocks = blocksWith(settings);
    const before = await blocks.blockFor("a");

    settings.indexLines = 1;
    const after = await blocks.blockFor("b");

    expect(before?.match(/- \[/g)).toHaveLength(2);
    expect(after?.match(/- \[/g)).toHaveLength(1);
  });

  test("applies changed exit thresholds to the next session without a new activation", async () => {
    const settings = { indexLines: 40, exitSessions: 20 };
    const blocks = blocksWith(settings);
    const before = await blocks.blockFor("a");

    settings.exitSessions = 5;
    const after = await blocks.blockFor("b");

    expect(before).toContain("First fact");
    expect(after).not.toContain("First fact");
    expect(after).not.toContain("Second fact");
  });
});

describe("createSessionBlocks with a full index", () => {
  test("shows a freshly saved fact ahead of an old fact that was read once", async () => {
    const old = fact("01JB8Z6Q4R3M2N1P0V9W8X0001", "Old fact");
    const saved = {
      ...fact("01JB8Z6Q4R3M2N1P0V9W8X0002", "Saved fact"),
      updated: "2026-05-30T00:00:00.000Z",
    };
    const { counters } = fakeCounters(
      new Map([[old.id, { ...UNSEEN, lastRead: new Date("2026-01-02T00:00:00.000Z") }]]),
    );
    const blocks = createSessionBlocks({
      instructions: INSTRUCTIONS,
      store: { inScopes: () => [old, saved] },
      ...NO_REGISTRY,
      recallScope: () => Promise.resolve({ chain: CHAIN, directory: "/d" }),
      indexLines: () => 1,
      indexExit: () => ({ sessions: 20, days: 30 }),
      counters,
      now: () => NOW,
      log: () => undefined,
    });

    const block = await blocks.blockFor("s");

    expect(block).toContain("Saved fact");
    expect(block).not.toContain("Old fact");
  });
});

describe("createSessionBlocks baseline", () => {
  const FIRST = "01JB8Z6Q4R3M2N1P0V9W8X0001";

  test("has none before the block is rendered", () => {
    expect(blocksOver([]).baselineOf("s")).toBeUndefined();
  });

  test("holds the stamp of each always-on and indexed memory the block was rendered from", async () => {
    const blocks = blocksOver([rule(FIRST, "A rule")]);
    await blocks.blockFor("s");

    expect(blocks.baselineOf("s")).toEqual(new Map([[memoryId(FIRST), new Date(0).toISOString()]]));
  });

  test("is dropped with the session", async () => {
    const blocks = blocksOver([]);
    await blocks.blockFor("s");

    blocks.forget("s");

    expect(blocks.baselineOf("s")).toBeUndefined();
  });
});

describe("createSessionBlocks product", () => {
  const tempDir = useTempDirs();
  const ORDERS = "github.com/acme/orders-svc";
  const CUSTOMERS = "github.com/acme/customers-svc";
  const HOME = "/home/lucas";
  const LINKED: ScopeChain = [
    { level: "user" },
    { level: "org", id: "github.com/acme" },
    { level: "product", id: "shop" },
    { level: "repo", id: ORDERS },
  ];

  interface Setup {
    readonly chain?: ScopeChain;
    readonly linked?: readonly string[];
    // Repo id -> work tree root, written to the registry.
    readonly checkouts?: Readonly<Record<string, string>>;
    readonly registryText?: string;
    readonly fs?: Partial<FileSystem>;
  }

  async function blockWith(setup: Setup, logged: Logged[] = []): Promise<string | null> {
    const registryFile = join(tempDir(), "registry.json");
    const linked = setup.linked ?? [];
    if (linked.length > 0) {
      await linkRepos(nodeFileSystem, registryFile, { repos: linked, product: "shop" });
    }
    const checkouts = Object.entries(setup.checkouts ?? {});
    for (const [repo, root] of checkouts) {
      await createCheckoutRecorder({
        fs: nodeFileSystem,
        registryFile,
        now: () => NOW,
        log: () => undefined,
      })(repo, root);
    }
    if (setup.registryText !== undefined) {
      nodeFileSystem.writeAtomic(registryFile, setup.registryText);
    }
    const blocks = createSessionBlocks({
      instructions: INSTRUCTIONS,
      store: { inScopes: () => [] },
      fs: { ...nodeFileSystem, ...setup.fs },
      registryFile,
      home: HOME,
      recallScope: () => Promise.resolve({ chain: setup.chain ?? LINKED, directory: "/d" }),
      indexLines: () => 40,
      indexExit: () => ({ sessions: 20, days: 30 }),
      counters: fakeCounters().counters,
      now: () => NOW,
      log: (level, msg, data) => {
        logged.push({ level, msg, data });
      },
    });
    return await blocks.blockFor("s");
  }

  function workTree(): string {
    const root = tempDir();
    mkdirSync(join(root, ".git"));
    return root;
  }

  test("keeps the plain product key in the scopes line and puts the map on its own line", async () => {
    const block = await blockWith({ linked: [ORDERS, CUSTOMERS] });

    expect(block).toContain(
      `Scopes here: user · org:github.com/acme · product:shop · repo:${ORDERS}\n` +
        "Product shop: orders-svc (here) · customers-svc (no checkout seen)",
    );
  });

  test("shows a sibling's checkout path while its .git exists", async () => {
    const root = workTree();

    const block = await blockWith({
      linked: [ORDERS, CUSTOMERS],
      checkouts: { [CUSTOMERS]: root },
    });

    expect(block).toContain(`customers-svc ${root}`);
  });

  test("shortens the home directory to a tilde", async () => {
    const fs = { exists: () => Promise.resolve(true) };

    const block = await blockWith({
      linked: [ORDERS, CUSTOMERS],
      checkouts: { [CUSTOMERS]: `${HOME}/src/customers` },
      fs,
    });

    expect(block).toContain("customers-svc ~/src/customers");
  });

  test("says no checkout was seen when the recorded work tree has no .git any more", async () => {
    const block = await blockWith({
      linked: [ORDERS, CUSTOMERS],
      checkouts: { [CUSTOMERS]: join(tempDir(), "gone") },
    });

    expect(block).toContain("customers-svc (no checkout seen)");
  });

  test("says no checkout was seen and warns when the work tree cannot be examined", async () => {
    const logged: Logged[] = [];
    const fs = {
      exists: () => Promise.reject(new Error("EACCES")),
    };

    const block = await blockWith(
      { linked: [ORDERS, CUSTOMERS], checkouts: { [CUSTOMERS]: "/src/customers" }, fs },
      logged,
    );

    expect(block).toContain("customers-svc (no checkout seen)");
    expect(logged.some((entry) => entry.level === "warn" && entry.msg.includes("checkout"))).toBe(
      true,
    );
  });

  test("looks at a work tree shared by two repos once", async () => {
    const asked: string[] = [];
    const exists = (path: string) => {
      asked.push(path);
      return Promise.resolve(true);
    };

    await blockWith({
      linked: [ORDERS, CUSTOMERS, "github.com/acme/billing-svc"],
      checkouts: { [CUSTOMERS]: "/src/mono", "github.com/acme/billing-svc": "/src/mono" },
      fs: { exists },
    });

    expect(asked).toEqual(["/src/mono/.git"]);
  });

  test("names the plain scopes only when the repo is not linked", async () => {
    const block = await blockWith({ chain: [{ level: "user" }, { level: "repo", id: ORDERS }] });

    expect(block).toEndWith(`Scopes here: user · repo:${ORDERS}`);
  });

  test("names the product without a map when the registry has no repos for it", async () => {
    const block = await blockWith({});

    expect(block).toContain(`product:shop · repo:${ORDERS}`);
    expect(block).not.toContain("Product shop:");
  });

  test("falls back to the member list and warns when the registry cannot be read", async () => {
    const logged: Logged[] = [];

    const block = await blockWith({ registryText: '{"products":{"shop":1}}' }, logged);

    expect(block).toContain(`product:shop · repo:${ORDERS}`);
    expect(
      logged.some((entry) => entry.level === "warn" && entry.msg.includes("product repos")),
    ).toBe(true);
  });

  test("falls back to the member list and warns when the checkouts cannot be read", async () => {
    const logged: Logged[] = [];
    const registryFile = join(tempDir(), "registry.json");
    nodeFileSystem.writeAtomic(
      registryFile,
      JSON.stringify({ products: { shop: { repos: [ORDERS, CUSTOMERS] } }, checkouts: 1 }),
    );
    const blocks = createSessionBlocks({
      instructions: INSTRUCTIONS,
      store: { inScopes: () => [] },
      fs: nodeFileSystem,
      registryFile,
      home: HOME,
      recallScope: () => Promise.resolve({ chain: LINKED, directory: "/d" }),
      indexLines: () => 40,
      indexExit: () => ({ sessions: 20, days: 30 }),
      counters: fakeCounters().counters,
      now: () => NOW,
      log: (level, msg, data) => {
        logged.push({ level, msg, data });
      },
    });

    const block = await blocks.blockFor("s");

    expect(block).toContain(`product:shop (${ORDERS}, ${CUSTOMERS}) · repo:${ORDERS}`);
    expect(logged.some((entry) => entry.level === "warn" && entry.msg.includes("checkouts"))).toBe(
      true,
    );
  });
});

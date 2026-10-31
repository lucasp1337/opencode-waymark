import { describe, expect, test } from "bun:test";
import { memoryId } from "../../../../test/memory-id";
import { type ContentInput, validContent } from "../../../../test/valid-content";
import type { MemoryId } from "../../model/id";
import { type Memory, newMemory, type Triggers } from "../../model/memory";
import { type ScopeChain, type ScopeRef, scopeKey } from "../../model/scope";
import type { ToolCallInfo } from "../../port";
import type { Telemetry } from "../../telemetry/telemetry";
import type { NoisyThresholds } from "../lifecycle/lifecycle-settings";
import { type Baseline, baselineOf } from "./fresh-memories";
import { createJit } from "./jit";
import type { RecallScope } from "./recall-scope";

const USER: ScopeRef = { level: "user" };
const REPO: ScopeRef = { level: "repo", id: "github.com/acme/api" };
const OTHER_REPO: ScopeRef = { level: "repo", id: "github.com/acme/web" };
const SESSION_SCOPE: RecallScope = { chain: [USER, REPO], directory: "/work/api" };
const NOW = new Date("2026-03-01T10:00:00.000Z");

function id(n: number): MemoryId {
  return memoryId(`01JB8Z6Q4R3M2N1P0V9W8X${String(n).padStart(4, "0")}`);
}

function stored(
  n: number,
  content: ContentInput,
  options: { scope?: ScopeRef; supersedes?: MemoryId } = {},
): Memory {
  return newMemory(validContent(content), {
    id: id(n),
    scope: options.scope ?? USER,
    now: NOW,
    ...(options.supersedes === undefined ? {} : { supersedes: options.supersedes }),
  });
}

function gotcha(n: number, title: string, triggers: Triggers, scope: ScopeRef = USER): Memory {
  return stored(n, { kind: "gotcha", title, body: `Body of ${title}.`, triggers }, { scope });
}

function onChain(memories: readonly Memory[], chain: ScopeChain): Memory[] {
  const keys = new Set(chain.map(scopeKey));
  return memories.filter((memory) => keys.has(scopeKey(memory.scope)));
}

const NOISY: NoisyThresholds = { fires: 10, days: 30 };

// Counters whose fires before a delivery are fixed by the test; they remember what was asked and
// recorded.
function fakeCounters(firesBefore = 0) {
  const fired: MemoryId[] = [];
  const asked: Array<{ id: MemoryId; days: number }> = [];
  const counters: Pick<Telemetry, "recordFire" | "firesWithin"> = {
    recordFire: (fireId) => {
      fired.push(fireId);
    },
    firesWithin: (fireId, days) => {
      asked.push({ id: fireId, days });
      return firesBefore;
    },
  };
  return { counters, fired, asked };
}

interface Setup {
  scope?: RecallScope | null;
  // The chain now, when a product link changed it after the session started.
  chain?: ScopeChain;
  currentChain?: () => Promise<ScopeChain>;
  // The frozen block's baseline; none means the session has no block.
  baseline?: Baseline;
  firesBefore?: number;
  // Memories the session wrote itself.
  isOwn?: (sessionID: string, memory: Memory) => boolean;
}

function jitWith(memories: readonly Memory[], setup: Setup = {}) {
  const reads = { count: 0 };
  const logged: string[] = [];
  const store = { generation: 0 };
  const scope = setup.scope === undefined ? SESSION_SCOPE : setup.scope;
  const { counters, fired, asked } = fakeCounters(setup.firesBefore);
  const jit = createJit({
    counters,
    noisy: NOISY,
    recallScope: () => Promise.resolve(scope),
    currentChain: setup.currentChain ?? (() => Promise.resolve(setup.chain ?? SESSION_SCOPE.chain)),
    log: (_level, msg) => {
      logged.push(msg);
    },
    baseline: () => setup.baseline,
    ownWrites: { isOwn: setup.isOwn ?? (() => false) },
    store: {
      inScopes: (chain) => {
        reads.count += 1;
        return onChain(memories, chain);
      },
      generation: () => store.generation,
    },
  });
  return { jit, reads, store, fired, asked, logged };
}

interface CallSpec {
  session?: string;
  tool?: string;
  paths?: string[];
  command?: string;
  appendable?: boolean;
}

function toolCall(spec: CallSpec = {}): ToolCallInfo {
  return {
    sessionID: spec.session ?? "s1",
    tool: spec.tool ?? "read",
    args: {},
    touchedPaths: spec.paths ?? [],
    appendable: spec.appendable ?? true,
    ...(spec.command === undefined ? {} : { command: spec.command }),
  };
}

const ON_BASH = gotcha(1, "Pushes are protected", { tools: ["bash"] });
const ON_READ = gotcha(2, "Reads are slow", { tools: ["read"] });

describe("JIT delivery", () => {
  test("appends a matching gotcha with its kind, title and body", async () => {
    const { jit } = jitWith([ON_BASH]);

    expect(await jit.onToolAfter(toolCall({ tool: "bash" }))).toBe(
      "waymark · gotcha · Pushes are protected\nBody of Pushes are protected.",
    );
  });

  test("returns null when nothing matches", async () => {
    const { jit } = jitWith([ON_BASH]);

    expect(await jit.onToolAfter(toolCall({ tool: "read" }))).toBeNull();
  });

  test("joins several matches with a blank line", async () => {
    const { jit } = jitWith([ON_BASH, gotcha(3, "Shell is slow", { tools: ["bash"] })]);

    expect(await jit.onToolAfter(toolCall({ tool: "bash" }))).toBe(
      "waymark · gotcha · Pushes are protected\nBody of Pushes are protected.\n\n" +
        "waymark · gotcha · Shell is slow\nBody of Shell is slow.",
    );
  });

  test("delivers a memory once per session", async () => {
    const { jit } = jitWith([ON_BASH]);

    await jit.onToolAfter(toolCall({ tool: "bash" }));

    expect(await jit.onToolAfter(toolCall({ tool: "bash" }))).toBeNull();
  });

  test("delivers the same memory again in another session", async () => {
    const { jit } = jitWith([ON_BASH]);

    await jit.onToolAfter(toolCall({ session: "s1", tool: "bash" }));

    expect(await jit.onToolAfter(toolCall({ session: "s2", tool: "bash" }))).not.toBeNull();
  });

  test("delivers each memory with the call that matches it", async () => {
    const { jit } = jitWith([ON_BASH, ON_READ]);

    await jit.onToolAfter(toolCall({ tool: "bash" }));

    expect(await jit.onToolAfter(toolCall({ tool: "read" }))).toBe(
      "waymark · gotcha · Reads are slow\nBody of Reads are slow.",
    );
  });

  test("passes the command of the call to command triggers", async () => {
    const { jit } = jitWith([gotcha(1, "Force pushes", { commands: ["git push"] })]);

    expect(
      await jit.onToolAfter(toolCall({ tool: "bash", command: "git push --force" })),
    ).not.toBeNull();
  });

  test("matches path triggers relative to the session directory", async () => {
    const { jit } = jitWith([gotcha(1, "Schema", { paths: ["src/db/**"] })]);

    expect(
      await jit.onToolAfter(toolCall({ tool: "edit", paths: ["/work/api/src/db/schema.ts"] })),
    ).not.toBeNull();
  });

  test("matches keywords against the words of the latest user message", async () => {
    const { jit } = jitWith([gotcha(1, "Migrations", { keywords: ["migration"] })]);
    await jit.onUserMessage("s1", "Please write the migration");

    expect(await jit.onToolAfter(toolCall())).not.toBeNull();
  });

  test("replaces the keyword words when the next user message arrives", async () => {
    const { jit } = jitWith([gotcha(1, "Migrations", { keywords: ["migration"] })]);
    await jit.onUserMessage("s1", "Please write the migration");
    await jit.onUserMessage("s1", "Now deploy");

    expect(await jit.onToolAfter(toolCall())).toBeNull();
  });

  test("keeps the user message words per session", async () => {
    const { jit } = jitWith([gotcha(1, "Migrations", { keywords: ["migration"] })]);
    await jit.onUserMessage("s1", "Please write the migration");

    expect(await jit.onToolAfter(toolCall({ session: "s2" }))).toBeNull();
  });

  test("delivers two parallel calls of one session only once", async () => {
    const { jit } = jitWith([ON_BASH]);

    const results = await Promise.all([
      jit.onToolAfter(toolCall({ tool: "bash" })),
      jit.onToolAfter(toolCall({ tool: "bash" })),
    ]);

    expect(results.filter((text) => text !== null)).toHaveLength(1);
  });
});

describe("JIT candidates", () => {
  test("delivers a fact that has triggers", async () => {
    const fact = stored(1, {
      kind: "fact",
      title: "Staging resets nightly",
      body: "At 02:00.",
      triggers: { tools: ["bash"] },
    });
    const { jit } = jitWith([fact]);

    expect(await jit.onToolAfter(toolCall({ tool: "bash" }))).toBe(
      "waymark · fact · Staging resets nightly\nAt 02:00.",
    );
  });

  test("ignores a fact without triggers", async () => {
    const fact = stored(1, { kind: "fact", title: "Staging resets nightly", body: "At 02:00." });
    const { jit } = jitWith([fact]);

    expect(await jit.onToolAfter(toolCall({ tool: "bash" }))).toBeNull();
  });

  const triggers: Triggers = { tools: ["bash"] };
  const notDelivered: [string, ContentInput][] = [
    ["rule", { kind: "rule", title: "T", body: "B", why: "W", triggers }],
    ["preference", { kind: "preference", title: "T", body: "B", triggers }],
    ["decision", { kind: "decision", title: "T", body: "B", why: "W", triggers }],
    [
      "reference",
      { kind: "reference", title: "T", body: "B", locator: "https://example.test/doc", triggers },
    ],
  ];

  test.each(notDelivered)(
    "does not deliver a %s even when its triggers match",
    async (_, content) => {
      const { jit } = jitWith([stored(1, content)]);

      expect(await jit.onToolAfter(toolCall({ tool: "bash" }))).toBeNull();
    },
  );

  test("does not deliver a superseded memory", async () => {
    const newer = stored(
      2,
      {
        kind: "gotcha",
        title: "Pushes are protected now",
        body: "New.",
        triggers: { tools: ["bash"] },
      },
      { supersedes: id(1) },
    );
    const { jit } = jitWith([ON_BASH, newer]);

    expect(await jit.onToolAfter(toolCall({ tool: "bash" }))).toBe(
      "waymark · gotcha · Pushes are protected now\nNew.",
    );
  });

  test("only considers memories on the session's chain", async () => {
    const elsewhere = gotcha(1, "Other repo", { tools: ["bash"] }, OTHER_REPO);
    const { jit } = jitWith([elsewhere]);

    expect(await jit.onToolAfter(toolCall({ tool: "bash" }))).toBeNull();
  });

  test("delivers a memory from a narrower scope on the chain", async () => {
    const inRepo = gotcha(1, "Repo only", { tools: ["bash"] }, REPO);
    const { jit } = jitWith([inRepo]);

    expect(await jit.onToolAfter(toolCall({ tool: "bash" }))).not.toBeNull();
  });

  test("a session forgotten while its chain is being read gets no state back", async () => {
    let release: () => void = () => undefined;
    let chainRequested: () => void = () => undefined;
    const requested = new Promise<void>((resolve) => {
      chainRequested = resolve;
    });
    const frozen = jitWith([ON_BASH], {
      baseline: baselineOf([]),
      currentChain: () =>
        new Promise((resolve) => {
          release = () => resolve(SESSION_SCOPE.chain);
          chainRequested();
        }),
    });
    const pending = frozen.jit.onToolAfter(toolCall({ tool: "bash" }));
    await requested;

    frozen.jit.forget("s1");
    release();

    expect(await pending).toBeNull();
    expect(frozen.fired).toEqual([]);
  });
});

describe("JIT with an unreadable current chain", () => {
  test("still delivers trigger matches and logs the failure instead of throwing", async () => {
    const { jit, logged } = jitWith([ON_BASH], {
      baseline: baselineOf([]),
      currentChain: () => Promise.reject(new Error("registry unreadable")),
    });

    expect(await jit.onToolAfter(toolCall({ tool: "bash" }))).toContain("Pushes are protected");
    expect(logged).toEqual(["current scope chain unavailable for recall"]);
  });
});

describe("JIT when the output cannot be appended", () => {
  test("holds a match back", async () => {
    const { jit } = jitWith([ON_BASH]);

    expect(await jit.onToolAfter(toolCall({ tool: "bash", appendable: false }))).toBeNull();
  });

  test("delivers the held match with the next appendable output", async () => {
    const { jit } = jitWith([ON_BASH]);
    await jit.onToolAfter(toolCall({ tool: "bash", appendable: false }));

    expect(await jit.onToolAfter(toolCall({ tool: "read" }))).toBe(
      "waymark · gotcha · Pushes are protected\nBody of Pushes are protected.",
    );
  });

  test("delivers a held match only once", async () => {
    const { jit } = jitWith([ON_BASH]);
    await jit.onToolAfter(toolCall({ tool: "bash", appendable: false }));
    await jit.onToolAfter(toolCall({ tool: "read" }));

    expect(await jit.onToolAfter(toolCall({ tool: "bash" }))).toBeNull();
  });

  test("does not hold the same match twice", async () => {
    const { jit } = jitWith([ON_BASH]);
    await jit.onToolAfter(toolCall({ tool: "bash", appendable: false }));
    await jit.onToolAfter(toolCall({ tool: "bash", appendable: false }));

    const text = await jit.onToolAfter(toolCall({ tool: "write" }));

    expect(text?.split("waymark ·")).toHaveLength(2);
  });

  test("delivers held matches oldest first", async () => {
    const { jit } = jitWith([ON_READ, ON_BASH]);
    await jit.onToolAfter(toolCall({ tool: "bash", appendable: false }));
    await jit.onToolAfter(toolCall({ tool: "read", appendable: false }));

    expect(await jit.onToolAfter(toolCall({ tool: "write" }))).toBe(
      "waymark · gotcha · Pushes are protected\nBody of Pushes are protected.\n\n" +
        "waymark · gotcha · Reads are slow\nBody of Reads are slow.",
    );
  });

  test("joins held matches with the matches of the appendable call", async () => {
    const { jit } = jitWith([ON_BASH, ON_READ]);
    await jit.onToolAfter(toolCall({ tool: "bash", appendable: false }));

    expect(await jit.onToolAfter(toolCall({ tool: "read" }))).toBe(
      "waymark · gotcha · Pushes are protected\nBody of Pushes are protected.\n\n" +
        "waymark · gotcha · Reads are slow\nBody of Reads are slow.",
    );
  });

  test("keeps held matches in the session that earned them", async () => {
    const { jit } = jitWith([ON_BASH]);
    await jit.onToolAfter(toolCall({ session: "s1", tool: "bash", appendable: false }));

    expect(await jit.onToolAfter(toolCall({ session: "s2", tool: "read" }))).toBeNull();
  });
});

describe("JIT for a session that gets no recall", () => {
  test("returns null for a matching call", async () => {
    const { jit } = jitWith([ON_BASH], { scope: null });

    expect(await jit.onToolAfter(toolCall({ tool: "bash" }))).toBeNull();
  });

  test("reads no memories", async () => {
    const { jit, reads } = jitWith([ON_BASH], { scope: null });

    await jit.onToolAfter(toolCall({ tool: "bash" }));

    expect(reads.count).toBe(0);
  });

  test("records nothing, so a later recall in the same session starts fresh", async () => {
    let scope: RecallScope | null = null;
    const jit = createJit({
      recallScope: () => Promise.resolve(scope),
      currentChain: () => Promise.resolve(SESSION_SCOPE.chain),
      baseline: () => undefined,
      ownWrites: { isOwn: () => false },
      store: { inScopes: (chain) => onChain([ON_BASH], chain), generation: () => 0 },
      counters: fakeCounters().counters,
      noisy: NOISY,
      log: () => undefined,
    });
    await jit.onToolAfter(toolCall({ tool: "bash", appendable: false }));
    scope = SESSION_SCOPE;

    expect(await jit.onToolAfter(toolCall({ tool: "read" }))).toBeNull();
    expect(await jit.onToolAfter(toolCall({ tool: "bash" }))).not.toBeNull();
  });
});

describe("JIT store reads", () => {
  test("reads the store once while nothing was saved or forgotten", async () => {
    const { jit, reads } = jitWith([ON_BASH, ON_READ]);

    await jit.onToolAfter(toolCall({ tool: "grep" }));
    await jit.onToolAfter(toolCall({ tool: "glob" }));

    expect(reads.count).toBe(1);
  });

  test("reads the store again after it changed", async () => {
    const { jit, reads, store } = jitWith([ON_BASH]);
    await jit.onToolAfter(toolCall({ tool: "grep" }));

    store.generation += 1;
    await jit.onToolAfter(toolCall({ tool: "glob" }));

    expect(reads.count).toBe(2);
  });
});

describe("JIT forget", () => {
  test("a forgotten session starts over, so a delivered gotcha comes again", async () => {
    const { jit } = jitWith([ON_BASH]);
    await jit.onToolAfter(toolCall({ tool: "bash" }));

    jit.forget("s1");

    expect(await jit.onToolAfter(toolCall({ tool: "bash" }))).not.toBeNull();
  });
});

describe("JIT fire counting", () => {
  test("records a fire for every memory it delivers", async () => {
    const fact = stored(3, {
      kind: "fact",
      title: "Staging resets nightly",
      body: "At 02:00.",
      triggers: { tools: ["bash"] },
    });
    const { jit, fired } = jitWith([ON_BASH, fact]);

    await jit.onToolAfter(toolCall({ tool: "bash" }));

    expect(fired).toEqual([id(1), id(3)]);
  });

  test("records nothing for a match that is held back", async () => {
    const { jit, fired } = jitWith([ON_BASH]);

    await jit.onToolAfter(toolCall({ tool: "bash", appendable: false }));

    expect(fired).toEqual([]);
  });

  test("records a held match when it is finally delivered", async () => {
    const { jit, fired } = jitWith([ON_BASH]);
    await jit.onToolAfter(toolCall({ tool: "bash", appendable: false }));

    await jit.onToolAfter(toolCall({ tool: "read" }));

    expect(fired).toEqual([id(1)]);
  });

  test("records nothing for a memory already delivered in the session", async () => {
    const { jit, fired } = jitWith([ON_BASH]);
    await jit.onToolAfter(toolCall({ tool: "bash" }));

    await jit.onToolAfter(toolCall({ tool: "bash" }));

    expect(fired).toEqual([id(1)]);
  });

  test("records a fire again for the same memory in another session", async () => {
    const { jit, fired } = jitWith([ON_BASH]);

    await jit.onToolAfter(toolCall({ session: "s1", tool: "bash" }));
    await jit.onToolAfter(toolCall({ session: "s2", tool: "bash" }));

    expect(fired).toEqual([id(1), id(1)]);
  });
});

describe("JIT noisy gotcha check", () => {
  const noisyLine = (fires: number, memoryId: MemoryId) =>
    `waymark · this gotcha fired ${fires} times in 30 days. Ask the user whether to keep it, ` +
    `forget it (memory_forget ${memoryId}), or turn it into a rule.`;

  test("adds no line to a gotcha that fired fewer times than the threshold", async () => {
    const { jit } = jitWith([ON_BASH], { firesBefore: 9 });

    expect(await jit.onToolAfter(toolCall({ tool: "bash" }))).toBe(
      "waymark · gotcha · Pushes are protected\nBody of Pushes are protected.",
    );
  });

  test("adds the line to a gotcha that fired exactly as often as the threshold", async () => {
    const { jit } = jitWith([ON_BASH], { firesBefore: 10 });

    expect(await jit.onToolAfter(toolCall({ tool: "bash" }))).toBe(
      `waymark · gotcha · Pushes are protected\nBody of Pushes are protected.\n${noisyLine(10, id(1))}`,
    );
  });

  test("counts the fires of the threshold's window, not of all time", async () => {
    const { jit, asked } = jitWith([ON_BASH]);

    await jit.onToolAfter(toolCall({ tool: "bash" }));

    expect(asked).toEqual([{ id: id(1), days: 30 }]);
  });

  test("asks about only one noisy gotcha per session", async () => {
    const { jit } = jitWith([ON_BASH, ON_READ], { firesBefore: 12 });

    const text = await jit.onToolAfter(toolCall({ tool: "bash" }));
    const later = await jit.onToolAfter(toolCall({ tool: "read" }));

    expect(text).toContain(noisyLine(12, id(1)));
    expect(later).toBe("waymark · gotcha · Reads are slow\nBody of Reads are slow.");
  });

  test("puts the line on the first of two noisy gotchas delivered together", async () => {
    const { jit } = jitWith([ON_BASH, gotcha(3, "Shell is slow", { tools: ["bash"] })], {
      firesBefore: 10,
    });

    expect(await jit.onToolAfter(toolCall({ tool: "bash" }))).toBe(
      `waymark · gotcha · Pushes are protected\nBody of Pushes are protected.\n${noisyLine(10, id(1))}` +
        "\n\nwaymark · gotcha · Shell is slow\nBody of Shell is slow.",
    );
  });

  test("asks again in the next session", async () => {
    const { jit } = jitWith([ON_BASH], { firesBefore: 10 });
    await jit.onToolAfter(toolCall({ session: "s1", tool: "bash" }));

    expect(await jit.onToolAfter(toolCall({ session: "s2", tool: "bash" }))).toContain(
      noisyLine(10, id(1)),
    );
  });

  test("does not ask about a fact with triggers, however often it fired", async () => {
    const fact = stored(3, {
      kind: "fact",
      title: "Staging resets nightly",
      body: "At 02:00.",
      triggers: { tools: ["bash"] },
    });
    const { jit } = jitWith([fact], { firesBefore: 50 });

    expect(await jit.onToolAfter(toolCall({ tool: "bash" }))).toBe(
      "waymark · fact · Staging resets nightly\nAt 02:00.",
    );
  });

  test("a fact does not use up the session's one question", async () => {
    const fact = stored(3, {
      kind: "fact",
      title: "Staging resets nightly",
      body: "At 02:00.",
      triggers: { tools: ["bash"] },
    });
    const { jit } = jitWith([fact, ON_READ], { firesBefore: 50 });
    await jit.onToolAfter(toolCall({ tool: "bash" }));

    expect(await jit.onToolAfter(toolCall({ tool: "read" }))).toContain(noisyLine(50, id(2)));
  });
});

describe("JIT memories saved after the session block was frozen", () => {
  const PRODUCT: ScopeRef = { level: "product", id: "shop" };
  const BEFORE = [
    stored(10, { kind: "rule", title: "Use UTC", body: "", why: "Logs." }),
    stored(11, { kind: "fact", title: "Staging resets nightly", body: "Reset at 02:00." }),
  ];

  function frozenWith(memories: Memory[], setup: Setup = {}) {
    return jitWith(memories, { baseline: baselineOf(BEFORE), ...setup });
  }

  function saveMidSession(fx: ReturnType<typeof jitWith>, memories: Memory[], saved: Memory) {
    memories.push(saved);
    fx.store.generation += 1;
  }

  test("delivers a rule saved mid-session with the next tool output, once", async () => {
    const memories = [...BEFORE];
    const fx = frozenWith(memories);
    const rule = stored(12, { kind: "rule", title: "No force push", body: "", why: "History." });

    saveMidSession(fx, memories, rule);
    const first = await fx.jit.onToolAfter(toolCall());

    expect(first).toBe("waymark · new rule · No force push\n- No force push\n  Why: History.");
    expect(await fx.jit.onToolAfter(toolCall())).toBeNull();
  });

  test("delivers a fact as an index line", async () => {
    const memories = [...BEFORE];
    const fx = frozenWith(memories);

    saveMidSession(fx, memories, stored(12, { kind: "fact", title: "Cache is Redis", body: "b" }));

    expect(await fx.jit.onToolAfter(toolCall())).toBe(
      `waymark · new fact (memory_read for the full text)\n- [${id(12)}] Cache is Redis`,
    );
  });

  test("does not repeat what the frozen block already holds", async () => {
    const fx = frozenWith([...BEFORE]);

    expect(await fx.jit.onToolAfter(toolCall())).toBeNull();
  });

  test("delivers an edited memory again under its new stamp", async () => {
    const memories = [...BEFORE];
    const fx = frozenWith(memories);

    memories[0] = {
      ...stored(10, { kind: "rule", title: "Use UTC", body: "", why: "New." }),
      updated: "2026-03-02T00:00:00.000Z",
    };
    fx.store.generation += 1;

    expect(await fx.jit.onToolAfter(toolCall())).toContain("Why: New.");
    expect(await fx.jit.onToolAfter(toolCall())).toBeNull();
  });

  test("delivers a memory another process saved into the shared store", async () => {
    const memories = [...BEFORE];
    const fx = frozenWith(memories);
    await fx.jit.onToolAfter(toolCall());

    saveMidSession(
      fx,
      memories,
      stored(12, { kind: "preference", title: "Short answers", body: "" }),
    );

    expect(await fx.jit.onToolAfter(toolCall({ session: "s1" }))).toContain("Short answers");
  });

  test("delivers the memories of a product linked mid-session", async () => {
    const memories = [
      ...BEFORE,
      stored(
        20,
        { kind: "rule", title: "Shop money is in cents", body: "", why: "Rounding." },
        { scope: PRODUCT },
      ),
    ];
    const fx = frozenWith(memories, { chain: [USER, PRODUCT, REPO] });

    expect(await fx.jit.onToolAfter(toolCall())).toContain("Shop money is in cents");
  });

  test("leaves a memory out of a scope the session is not in", async () => {
    const memories = [...BEFORE];
    const fx = frozenWith(memories);

    saveMidSession(
      fx,
      memories,
      stored(12, { kind: "rule", title: "Elsewhere", body: "", why: "w" }, { scope: OTHER_REPO }),
    );

    expect(await fx.jit.onToolAfter(toolCall())).toBeNull();
  });

  test("waits for an output that can carry text", async () => {
    const memories = [...BEFORE];
    const fx = frozenWith(memories);
    saveMidSession(
      fx,
      memories,
      stored(12, { kind: "preference", title: "Short answers", body: "" }),
    );

    expect(await fx.jit.onToolAfter(toolCall({ appendable: false }))).toBeNull();
    expect(await fx.jit.onToolAfter(toolCall())).toContain("Short answers");
  });

  test("delivers once per session, to each session", async () => {
    const memories = [...BEFORE];
    const fx = frozenWith(memories);
    saveMidSession(
      fx,
      memories,
      stored(12, { kind: "preference", title: "Short answers", body: "" }),
    );

    await fx.jit.onToolAfter(toolCall({ session: "s1" }));

    expect(await fx.jit.onToolAfter(toolCall({ session: "s2" }))).toContain("Short answers");
  });

  test("does not deliver a memory the session itself saved", async () => {
    const memories = [...BEFORE];
    const rule = stored(12, { kind: "rule", title: "No force push", body: "", why: "History." });
    const fx = frozenWith(memories, { isOwn: (sessionID) => sessionID === "s1" });
    saveMidSession(fx, memories, rule);

    expect(await fx.jit.onToolAfter(toolCall({ session: "s1" }))).toBeNull();
  });

  test("delivers a memory saved by one session to another session", async () => {
    const memories = [...BEFORE];
    const rule = stored(12, { kind: "rule", title: "No force push", body: "", why: "History." });
    const fx = frozenWith(memories, { isOwn: (sessionID) => sessionID === "s1" });
    saveMidSession(fx, memories, rule);

    expect(await fx.jit.onToolAfter(toolCall({ session: "s2" }))).toContain("No force push");
  });

  test("does not count a fresh memory as a trigger fire", async () => {
    const memories = [...BEFORE];
    const fx = frozenWith(memories);
    saveMidSession(
      fx,
      memories,
      stored(12, { kind: "preference", title: "Short answers", body: "" }),
    );

    await fx.jit.onToolAfter(toolCall());

    expect(fx.fired).toEqual([]);
  });

  test("delivers nothing in a session without a frozen block", async () => {
    const fx = jitWith([...BEFORE]);

    expect(await fx.jit.onToolAfter(toolCall())).toBeNull();
  });

  test("joins a fresh memory to a matched gotcha in one output", async () => {
    const memories = [...BEFORE, ON_BASH];
    const fx = frozenWith(memories, { baseline: baselineOf(BEFORE) });
    saveMidSession(
      fx,
      memories,
      stored(12, { kind: "preference", title: "Short answers", body: "" }),
    );

    const text = await fx.jit.onToolAfter(toolCall({ tool: "bash" }));

    expect(text).toContain("Pushes are protected");
    expect(text).toContain("Short answers");
  });
});

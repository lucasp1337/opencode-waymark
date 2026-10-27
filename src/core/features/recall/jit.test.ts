import { describe, expect, test } from "bun:test";
import { memoryId } from "../../../../test/memory-id";
import { validContent } from "../../../../test/valid-content";
import type { MemoryId } from "../../model/id";
import { type Memory, type MemoryContent, newMemory, type Triggers } from "../../model/memory";
import { type ScopeChain, type ScopeRef, scopeKey } from "../../model/scope";
import type { ToolCallInfo } from "../../port";
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
  content: MemoryContent,
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

interface Setup {
  scope?: RecallScope | null;
}

function jitWith(memories: readonly Memory[], setup: Setup = {}) {
  const reads = { count: 0 };
  const store = { generation: 0 };
  const scope = setup.scope === undefined ? SESSION_SCOPE : setup.scope;
  const jit = createJit({
    recallScope: () => Promise.resolve(scope),
    store: {
      inScopes: (chain) => {
        reads.count += 1;
        return onChain(memories, chain);
      },
      generation: () => store.generation,
    },
  });
  return { jit, reads, store };
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
  const notDelivered: [string, MemoryContent][] = [
    ["rule", { kind: "rule", title: "T", body: "B", why: "W", triggers }],
    ["preference", { kind: "preference", title: "T", body: "B", triggers }],
    ["decision", { kind: "decision", title: "T", body: "B", why: "W", triggers }],
    ["reference", { kind: "reference", title: "T", body: "https://example.test/doc", triggers }],
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
      store: { inScopes: (chain) => onChain([ON_BASH], chain), generation: () => 0 },
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

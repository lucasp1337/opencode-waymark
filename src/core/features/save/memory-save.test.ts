import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  PLAIN_SESSION,
  type RuntimeFixture,
  SESSION,
  useRuntime,
} from "../../../../test/runtime-fixture";
import { nodeFileSystem } from "../../store/fs";

const fixture = useRuntime();

const fact = { kind: "fact", title: "Staging resets nightly", body: "All data is wiped at 02:00." };

function save(fx: RuntimeFixture, input: object, session = SESSION): Promise<string> {
  return fx.host.callTool("memory_save", input, session);
}

function memoryFiles(fx: RuntimeFixture): string[] {
  return nodeFileSystem
    .listFiles(fx.dataDir)
    .filter((path) => path.endsWith(".md"))
    .map((path) => relative(fx.dataDir, path))
    .sort();
}

describe("memory_save", () => {
  test("a user memory lands under user/<kind>/<id>.md", async () => {
    const fx = fixture();

    const reply = await save(fx, { ...fact, scope: "user" });

    expect(reply).toBe("Saved [01JB8Z6Q4R3M2N1P0V9W8X0001] fact · user · Staging resets nightly");
    expect(memoryFiles(fx)).toEqual(["user/fact/01JB8Z6Q4R3M2N1P0V9W8X0001.md"]);
  });

  test("an org memory lands under the org's host/owner directory", async () => {
    const fx = fixture();

    await save(fx, { ...fact, scope: "org" });

    expect(memoryFiles(fx)).toEqual(["orgs/github.com/acme/fact/01JB8Z6Q4R3M2N1P0V9W8X0001.md"]);
  });

  test("a repo memory lands under the repo's host/owner/name directory", async () => {
    const fx = fixture();

    await save(fx, { ...fact, scope: "repo" });

    expect(memoryFiles(fx)).toEqual([
      "repos/github.com/acme/api/fact/01JB8Z6Q4R3M2N1P0V9W8X0001.md",
    ]);
  });

  test("the saved file holds the memory as markdown with frontmatter", async () => {
    const fx = fixture();

    await save(fx, { ...fact, scope: "user" });

    const text = readFileSync(join(fx.dataDir, "user/fact/01JB8Z6Q4R3M2N1P0V9W8X0001.md"), "utf8");
    expect(text).toContain("title: Staging resets nightly");
    expect(text).toEndWith("---\nAll data is wiped at 02:00.");
  });

  test("a save to a scope the session lacks is refused and names the scopes it has", async () => {
    const fx = fixture();

    const reply = await save(fx, { ...fact, scope: "product" });

    expect(reply).toBe(
      "Not saved: this session has no product scope; it has user, org:github.com/acme, repo:github.com/acme/api.",
    );
    expect(memoryFiles(fx)).toEqual([]);
  });

  test("a session outside any repository only has the user scope", async () => {
    const fx = fixture();

    const reply = await save(fx, { ...fact, scope: "repo" }, PLAIN_SESSION);

    expect(reply).toBe("Not saved: this session has no repo scope; it has user.");
  });

  test("validation problems are reported together and nothing is written", async () => {
    const fx = fixture();

    const reply = await save(fx, { kind: "rule", scope: "team", title: "a\nb", body: "x" });

    expect(reply).toBe(
      "Not saved: title must be a single line; scope must be one of user, org, product, repo",
    );
    expect(memoryFiles(fx)).toEqual([]);
  });

  test("a kind requirement that is not met is refused", async () => {
    const fx = fixture();

    const reply = await save(fx, { ...fact, kind: "rule", scope: "user" });

    expect(reply).toBe("Not saved: rule needs why: the reason it holds");
  });

  test("toasts the kind and scope of a saved memory", async () => {
    const fx = fixture();

    await save(fx, { ...fact, scope: "repo" });

    expect(fx.host.toasts).toContain("waymark · saved fact · repo:github.com/acme/api");
  });
});

describe("memory_save with related memories", () => {
  async function withExisting(): Promise<RuntimeFixture> {
    const fx = fixture();
    await save(fx, { ...fact, scope: "repo" });
    return fx;
  }

  test("memories outside the session's chain are not offered as related", async () => {
    const fx = await withExisting();

    const reply = await save(fx, { ...fact, scope: "user" }, PLAIN_SESSION);

    expect(reply).toStartWith("Saved [01JB8Z6Q4R3M2N1P0V9W8X0002]");
  });

  test("offers at most three related memories", async () => {
    const fx = await withExisting();
    for (const title of ["Staging A", "Staging B", "Staging C"]) {
      await save(fx, { ...fact, title, scope: "repo", relation: "new" });
    }

    const reply = await save(fx, { ...fact, scope: "repo" });

    expect(reply.split("\n").filter((line) => line.startsWith("- ["))).toHaveLength(3);
  });

  test("a near-duplicate returns the related memory and writes nothing", async () => {
    const fx = await withExisting();

    const reply = await save(fx, {
      ...fact,
      title: "Staging is reset every night",
      scope: "user",
    });

    expect(reply).toStartWith("Not saved yet: related memories exist.");
    expect(reply).toContain(
      "- [01JB8Z6Q4R3M2N1P0V9W8X0001] fact · repo:github.com/acme/api · Staging resets nightly",
    );
    expect(memoryFiles(fx)).toHaveLength(1);
  });

  test("relation new saves despite related memories", async () => {
    const fx = await withExisting();

    const reply = await save(fx, { ...fact, scope: "user", relation: "new" });

    expect(reply).toStartWith("Saved [01JB8Z6Q4R3M2N1P0V9W8X0002]");
    expect(memoryFiles(fx)).toHaveLength(2);
  });

  test("relation updates:<id> rewrites the memory in place, keeping its id and created date", async () => {
    const fx = await withExisting();
    fx.clock.advance(60_000);

    const reply = await save(fx, {
      ...fact,
      body: "Wiped at 03:00 since March.",
      scope: "repo",
      relation: "updates:01JB8Z6Q4R3M2N1P0V9W8X0001",
    });

    expect(reply).toStartWith("Saved [01JB8Z6Q4R3M2N1P0V9W8X0001]");
    const read = await fx.host.callTool(
      "memory_read",
      { id: "01JB8Z6Q4R3M2N1P0V9W8X0001" },
      SESSION,
    );
    expect(read).toContain("created: 2026-03-01T10:00:00.000Z");
    expect(read).toContain("updated: 2026-03-01T10:01:00.000Z");
    expect(read).toEndWith("Wiped at 03:00 since March.");
    expect(memoryFiles(fx)).toHaveLength(1);
  });

  test("relation updates:<id> can move a memory to another scope", async () => {
    const fx = await withExisting();

    await save(fx, { ...fact, scope: "user", relation: "updates:01JB8Z6Q4R3M2N1P0V9W8X0001" });

    expect(memoryFiles(fx)).toEqual(["user/fact/01JB8Z6Q4R3M2N1P0V9W8X0001.md"]);
  });

  test("relation supersedes:<id> writes a new memory that names the old one", async () => {
    const fx = await withExisting();

    await save(fx, { ...fact, scope: "repo", relation: "supersedes:01JB8Z6Q4R3M2N1P0V9W8X0001" });

    const read = await fx.host.callTool(
      "memory_read",
      { id: "01JB8Z6Q4R3M2N1P0V9W8X0002" },
      SESSION,
    );
    expect(read).toContain("supersedes: 01JB8Z6Q4R3M2N1P0V9W8X0001");
    expect(memoryFiles(fx)).toHaveLength(2);
  });

  test("a relation to an unknown memory is refused", async () => {
    const fx = await withExisting();

    const reply = await save(fx, {
      ...fact,
      scope: "repo",
      relation: "updates:01JB8Z6Q4R3M2N1P0V9W8X9999",
    });

    expect(reply).toBe("Not saved: no memory with id 01JB8Z6Q4R3M2N1P0V9W8X9999");
  });

  test("a malformed relation is refused", async () => {
    const fx = await withExisting();

    const reply = await save(fx, { ...fact, scope: "repo", relation: "replaces:x" });

    expect(reply).toBe(
      'Not saved: relation must be "new", "updates:<id>" or "supersedes:<id>", got "replaces:x"',
    );
  });
});

describe("memory_save kinds", () => {
  test("a gotcha keeps its triggers", async () => {
    const fx = fixture();

    await save(fx, {
      kind: "gotcha",
      scope: "repo",
      title: "Migrations lock the users table",
      body: "Run them off-peak.",
      triggers: { paths: ["db/migrations/**"], commands: ["make migrate"] },
    });

    const read = await fx.host.callTool(
      "memory_read",
      { id: "01JB8Z6Q4R3M2N1P0V9W8X0001" },
      SESSION,
    );
    expect(read).toContain(
      "triggers:\n  paths:\n    - db/migrations/**\n  commands:\n    - make migrate",
    );
  });

  test("a reference with a locator is saved", async () => {
    const fx = fixture();

    const reply = await save(fx, {
      kind: "reference",
      scope: "org",
      title: "Deploy runbook",
      body: "https://wiki.example.com/deploy",
    });

    expect(reply).toStartWith("Saved [01JB8Z6Q4R3M2N1P0V9W8X0001] reference · org:github.com/acme");
  });

  test("a session the host does not know turns into a tool message", async () => {
    const fx = fixture();

    const reply = await save(fx, { ...fact, scope: "user" }, "ses_unknown");

    expect(reply).toBe(
      "memory_save failed inside Waymark (Error: unknown session ses_unknown); details are in the Waymark log.",
    );
  });
});

describe("memory_save budget", () => {
  const rule = (title: string, body: string) => ({
    kind: "rule",
    scope: "repo",
    title,
    body,
    why: "w",
    relation: "new",
  });

  test("refuses a rule that would exceed the scope's cap and lists the current ones", async () => {
    const fx = fixture();
    await save(fx, rule("Long rule", "x".repeat(2000)));

    const reply = await save(fx, rule("Another rule", "y".repeat(400)));

    expect(reply).toStartWith(
      "Not saved: rule and preference memories in repo:github.com/acme/api are capped at 600 tokens; 506 are used and this one needs 107.",
    );
    expect(reply).toContain(
      "- [01JB8Z6Q4R3M2N1P0V9W8X0001] rule · repo:github.com/acme/api · Long rule (506 tokens)",
    );
    expect(
      existsSync(join(fx.dataDir, "repos/github.com/acme/api/rule/01JB8Z6Q4R3M2N1P0V9W8X0002.md")),
    ).toBe(false);
  });

  test("the user scope is capped at 400 tokens", async () => {
    const fx = fixture();

    const reply = await save(fx, { ...rule("Big", "x".repeat(1600)), scope: "user" });

    expect(reply).toStartWith(
      "Not saved: rule and preference memories in user are capped at 400 tokens; 0 are used",
    );
  });

  test("the org scope is capped at 600 tokens", async () => {
    const fx = fixture();
    await save(fx, { ...rule("Org rule", "x".repeat(2300)), scope: "org" });

    const reply = await save(fx, { ...rule("Second", "y".repeat(100)), scope: "org" });

    expect(reply).toStartWith(
      "Not saved: rule and preference memories in org:github.com/acme are capped at 600 tokens",
    );
  });

  test("facts do not count against the always-on budget", async () => {
    const fx = fixture();
    await save(fx, rule("Long rule", "x".repeat(2300)));

    const reply = await save(fx, {
      ...fact,
      body: "z".repeat(4000),
      scope: "repo",
      relation: "new",
    });

    expect(reply).toStartWith("Saved");
  });

  test("a superseded rule leaves the budget when its successor is saved", async () => {
    const fx = fixture();
    await save(fx, rule("Long rule", "x".repeat(2000)));

    const reply = await save(fx, {
      ...rule("Shorter rule", "y".repeat(1000)),
      relation: "supersedes:01JB8Z6Q4R3M2N1P0V9W8X0001",
    });

    expect(reply).toStartWith("Saved");
  });
});

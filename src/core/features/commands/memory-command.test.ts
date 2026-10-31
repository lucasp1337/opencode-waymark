import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ACME_ORG,
  API_REPO,
  API_SESSION,
  COMMAND_TIME,
  idNumber,
  NOTES_SESSION,
  USER,
  useCommandFixture,
  WEB_SESSION,
} from "../../../../test/commands-fixture";

const fixture = useCommandFixture();

const ID_1 = idNumber(1);
const ID_2 = idNumber(2);
const ID_3 = idNumber(3);

describe("memory_command with no arguments", () => {
  test("lists each scope of the chain, broadest first, with counts and memories grouped by kind", async () => {
    const fx = fixture();
    fx.seed({
      n: 1,
      scope: USER,
      content: { kind: "preference", title: "Reply briefly", body: "" },
    });
    fx.seed({
      n: 2,
      scope: ACME_ORG,
      content: { kind: "rule", title: "Sign commits", body: "Always.", why: "policy" },
    });
    fx.seed({
      n: 3,
      scope: API_REPO,
      content: { kind: "fact", title: "Staging resets", body: "" },
    });
    fx.seed({ n: 4, scope: API_REPO, content: { kind: "fact", title: "Deploy window", body: "" } });
    fx.seed({
      n: 5,
      scope: API_REPO,
      content: { kind: "gotcha", title: "Flaky test", body: "", triggers: { tools: ["bash"] } },
    });

    expect(await fx.run("")).toBe(
      [
        "## user (1)",
        "preference (1)",
        `- [${ID_1}] preference · user · Reply briefly (2026-03-01)`,
        "",
        "## org:github.com/acme (1)",
        "rule (1)",
        `- [${ID_2}] rule · org:github.com/acme · Sign commits (2026-03-01)`,
        "",
        "## repo:github.com/acme/api (3)",
        "fact (2)",
        `- [${ID_3}] fact · repo:github.com/acme/api · Staging resets (2026-03-01)`,
        `- [${idNumber(4)}] fact · repo:github.com/acme/api · Deploy window (2026-03-01)`,
        "gotcha (1)",
        `- [${idNumber(5)}] gotcha · repo:github.com/acme/api · Flaky test (2026-03-01)`,
      ].join("\n"),
    );
  });

  test("a scope without memories is listed with a count of zero", async () => {
    const fx = fixture();

    expect(await fx.run("")).toBe(
      ["## user (0)", "", "## org:github.com/acme (0)", "", "## repo:github.com/acme/api (0)"].join(
        "\n",
      ),
    );
  });

  test("outside a repository only the user scope is listed", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: USER, content: { kind: "fact", title: "Mine", body: "" } });

    expect(await fx.run("", NOTES_SESSION)).toBe(
      ["## user (1)", "fact (1)", `- [${ID_1}] fact · user · Mine (2026-03-01)`].join("\n"),
    );
  });

  test("memories of other repos are not listed", async () => {
    const fx = fixture();
    fx.seed({
      n: 1,
      scope: { level: "repo", id: "github.com/acme-labs/web" },
      content: { kind: "fact", title: "Web only", body: "" },
    });

    expect(await fx.run("")).not.toContain("Web only");
  });

  test("a memory that was replaced is not listed", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: API_REPO, content: { kind: "fact", title: "Old", body: "" } });
    fx.seed({
      n: 2,
      scope: API_REPO,
      content: { kind: "fact", title: "New", body: "" },
      supersedes: 1,
    });

    const listing = await fx.run("");

    expect(listing).toContain("New");
    expect(listing).not.toContain("Old");
  });

  test("a call without args lists too", async () => {
    const fx = fixture();

    expect(await fx.host.callTool("memory_command", {}, API_SESSION)).toBe(await fx.run(""));
  });

  test("args that are not text are refused", async () => {
    const fx = fixture();

    expect(await fx.host.callTool("memory_command", { args: 7 }, API_SESSION)).toBe(
      "Not run: args must be a string",
    );
  });
});

describe("memory_command listing of a long scope and a linked product", () => {
  test("lists at most 40 memories of a scope and says how many more there are", async () => {
    const fx = fixture();
    for (let n = 1; n <= 43; n++) {
      fx.seed({ n, scope: USER, content: { kind: "fact", title: `Fact ${n}`, body: "" } });
    }

    const listing = await fx.run("");

    expect(listing).toContain("## user (43)");
    expect(listing.match(/^- \[/gm)).toHaveLength(40);
    expect(listing).toContain("+3 more — use memory_search");
  });

  test("shows no overflow line while a scope fits", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: USER, content: { kind: "fact", title: "Mine", body: "" } });

    expect(await fx.run("")).not.toContain("more");
  });

  test("names the linked product and its repos at the top", async () => {
    const fx = fixture();
    await fx.run("link payments");
    await fx.run("link payments", WEB_SESSION);

    expect(await fx.run("")).toStartWith(
      "Product payments: github.com/acme/api, github.com/acme-labs/web\n\n## user",
    );
  });

  test("a repo without a product has no product line", async () => {
    const fx = fixture();

    expect(await fx.run("")).not.toContain("Product");
  });
});

describe("memory_command review", () => {
  const signals = (leftIndex: number[], noisy: number[]) => ({
    leftIndex: leftIndex.map(idNumber),
    noisy: noisy.map(idNumber),
  });
  const withSignals = useCommandFixture({ reviewSignals: signals([1], [2]) });
  const withStaleSignals = useCommandFixture({ reviewSignals: signals([9], [9]) });

  test("lists a superseded memory with the memory that replaced it", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: API_REPO, content: { kind: "fact", title: "Old", body: "" } });
    fx.seed({
      n: 2,
      scope: API_REPO,
      content: { kind: "fact", title: "New", body: "" },
      supersedes: 1,
    });

    const report = await fx.run("review");

    expect(report).toContain(
      `Superseded, still on disk:\n- [${ID_1}] fact · repo:github.com/acme/api · Old (2026-03-01) (replaced by [${ID_2}])`,
    );
    expect(report).not.toContain("· New");
  });

  test("lists memories that left the index and gotchas that fire often from the injected signals", async () => {
    const fx = withSignals();
    fx.seed({
      n: 1,
      scope: API_REPO,
      content: { kind: "fact", title: "Forgotten fact", body: "" },
    });
    fx.seed({
      n: 2,
      scope: API_REPO,
      content: { kind: "gotcha", title: "Noisy one", body: "", triggers: { tools: ["bash"] } },
    });

    const report = await fx.run("review");

    expect(report).toContain(
      `Left the session index, still searchable:\n- [${ID_1}] fact · repo:github.com/acme/api · Forgotten fact (2026-03-01)`,
    );
    expect(report).toContain(
      `Gotchas that fire often:\n- [${ID_2}] gotcha · repo:github.com/acme/api · Noisy one (2026-03-01)`,
    );
  });

  test("ignores signals about memories that no longer exist", async () => {
    const fx = withStaleSignals();

    expect(await fx.run("review")).toStartWith("Nothing needs review");
  });

  test("ends with what the agent should offer the user", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: API_REPO, content: { kind: "fact", title: "Old", body: "" } });
    fx.seed({
      n: 2,
      scope: API_REPO,
      content: { kind: "fact", title: "New", body: "" },
      supersedes: 1,
    });

    const report = await fx.run("review");

    expect(report).toContain("keep it; forget it (memory_forget); merge it into another memory");
    expect(report).toEndWith(
      "turn it into a rule (memory_save with kind rule and a why, then memory_forget this).",
    );
  });

  test("says so when nothing needs attention", async () => {
    const fx = fixture();

    expect(await fx.run("review")).toStartWith("Nothing needs review");
  });
});

describe("memory_command move", () => {
  const tinyFact = { kind: "fact", title: "Staging resets", body: "At 02:00." } as const;

  test("moves a memory to another scope of the chain, keeping its id and bumping updated", async () => {
    const fx = fixture();
    const before = fx.seed({ n: 1, scope: API_REPO, content: tinyFact });

    const reply = await fx.run(`move ${ID_1} org`);

    expect(reply).toBe(`Moved [${ID_1}] fact · org:github.com/acme · Staging resets (2026-03-02)`);
    const after = fx.store.get(ID_1);
    expect(after?.scope).toEqual(ACME_ORG);
    expect(after?.created).toBe(before.created);
    expect(after?.updated).toBe(COMMAND_TIME.toISOString());
  });

  test("the file follows the memory to its new scope directory", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: API_REPO, content: tinyFact });

    await fx.run(`move ${ID_1} user`);

    expect(existsSync(join(fx.dataDir, "user", "fact", `${ID_1}.md`))).toBe(true);
    expect(existsSync(join(fx.dataDir, "repos", "github.com/acme/api", "fact", `${ID_1}.md`))).toBe(
      false,
    );
  });

  test("toasts the kind and the new scope", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: API_REPO, content: tinyFact });

    await fx.run(`move ${ID_1} org`);

    expect(fx.host.toasts).toContain("waymark · moved fact · org:github.com/acme");
  });

  test("refuses an unknown id", async () => {
    const fx = fixture();

    expect(await fx.run(`move ${ID_1} org`)).toBe(`Not moved: no memory with id ${ID_1}`);
  });

  test("refuses a scope the session does not have and names the ones it has", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: USER, content: tinyFact });

    expect(await fx.run(`move ${ID_1} repo`, NOTES_SESSION)).toBe(
      "Not moved: this session has no repo scope; it has user.",
    );
    expect(fx.store.get(ID_1)?.scope).toEqual(USER);
  });

  test("refuses a product move when the session has no product", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: API_REPO, content: tinyFact });

    expect(await fx.run(`move ${ID_1} product`)).toStartWith(
      "Not moved: this session has no product scope",
    );
  });

  test("refuses to move a memory to the scope it is already in", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: API_REPO, content: tinyFact });

    expect(await fx.run(`move ${ID_1} repo`)).toBe(
      `Not moved: [${ID_1}] fact · repo:github.com/acme/api · Staging resets (2026-03-01) is already in repo:github.com/acme/api.`,
    );
    expect(fx.store.get(ID_1)?.updated).not.toBe(COMMAND_TIME.toISOString());
  });

  test("a rule moves when it fits the target scope's cap", async () => {
    const fx = fixture();
    fx.seed({
      n: 1,
      scope: API_REPO,
      content: { kind: "rule", title: "Use UTC", body: "Everywhere.", why: "logs" },
    });

    expect(await fx.run(`move ${ID_1} user`)).toStartWith("Moved ");
  });

  test("refuses a rule that would overflow the target scope's cap and leaves everything in place", async () => {
    const fx = fixture();
    fx.seed({
      n: 1,
      scope: ACME_ORG,
      content: { kind: "rule", title: "Sign commits", body: "x".repeat(150), why: "policy" },
    });
    fx.seed({
      n: 2,
      scope: API_REPO,
      content: { kind: "rule", title: "Use UTC", body: "y".repeat(60), why: "logs" },
    });

    const reply = await fx.run(`move ${ID_2} org`);

    expect(reply).toStartWith(
      "Not moved: rule and preference memories in org:github.com/acme are capped at 50 tokens; 49 are used and the memory needs 25.",
    );
    expect(reply).toContain(
      `- [${ID_1}] rule · org:github.com/acme · Sign commits (2026-03-01) (49 tokens)`,
    );
    expect(reply).toContain(
      "merge these memories, demote one to a fact, or raise the cap with memory_config",
    );
    expect(fx.store.get(ID_2)?.scope).toEqual(API_REPO);
    expect(fx.host.toasts.filter((toast) => toast.includes("moved"))).toEqual([]);
  });

  test("a fact moves into a scope whose rule budget is full", async () => {
    const fx = fixture();
    fx.seed({
      n: 1,
      scope: ACME_ORG,
      content: { kind: "rule", title: "Sign commits", body: "x".repeat(150), why: "policy" },
    });
    fx.seed({
      n: 2,
      scope: API_REPO,
      content: { kind: "fact", title: "Big", body: "z".repeat(500) },
    });

    expect(await fx.run(`move ${ID_2} org`)).toStartWith("Moved ");
  });

  // Ids are global, as for memory_read, memory_update and memory_forget; only the target must be
  // on this session's chain.
  test("moves a memory of another repo when the target is on the session's chain", async () => {
    const fx = fixture();
    fx.seed({
      n: 1,
      scope: { level: "repo", id: "github.com/acme-labs/web" },
      content: tinyFact,
    });

    const reply = await fx.run(`move ${ID_1} user`);

    expect(reply).toStartWith("Moved ");
    expect(fx.store.get(ID_1)?.scope).toEqual(USER);
  });

  test("accepts the id as shown in brackets", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: API_REPO, content: tinyFact });

    expect(await fx.run(`move [${ID_1}] org`)).toStartWith("Moved ");
  });
});

describe("memory_command move and replaced memories", () => {
  const fact = (title: string) => ({ kind: "fact", title, body: "" }) as const;

  test("refuses to move a memory that was replaced, which would show it again", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: API_REPO, content: fact("Old") });
    fx.seed({ n: 2, scope: API_REPO, content: fact("New"), supersedes: 1 });

    expect(await fx.run(`move ${ID_1} org`)).toBe(
      `Not moved: [${ID_1}] was replaced by [${ID_2}]; forget it or move the replacement.`,
    );
    expect(fx.store.get(ID_1)?.scope).toEqual(API_REPO);
  });

  test("refuses to move a replaced memory whose replacement is in another scope of the chain", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: ACME_ORG, content: fact("Old") });
    fx.seed({ n: 2, scope: API_REPO, content: fact("New"), supersedes: 1 });

    expect(await fx.run(`move ${ID_1} user`)).toStartWith(
      `Not moved: [${ID_1}] was replaced by [${ID_2}]`,
    );
  });

  test("refuses to move a replaced memory of another repo when its replacement is next to it", async () => {
    const fx = fixture();
    const web = { level: "repo", id: "github.com/acme-labs/web" } as const;
    fx.seed({ n: 1, scope: web, content: fact("Old") });
    fx.seed({ n: 2, scope: web, content: fact("New"), supersedes: 1 });

    expect(await fx.run(`move ${ID_1} user`)).toStartWith("Not moved: ");
    expect(fx.store.get(ID_1)?.scope).toEqual(web);
  });

  test("moves a replaced memory whose replacement was forgotten", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: API_REPO, content: fact("Old") });
    const replacement = fx.seed({ n: 2, scope: API_REPO, content: fact("New"), supersedes: 1 });
    fx.store.forget(replacement);

    expect(await fx.run(`move ${ID_1} org`)).toStartWith("Moved ");
  });

  test("a replacement may move to a broader scope, where it still hides what it replaced", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: API_REPO, content: fact("Old") });
    fx.seed({ n: 2, scope: API_REPO, content: fact("New"), supersedes: 1 });

    expect(await fx.run(`move ${ID_2} org`)).toStartWith("Moved ");
    expect(await fx.run(`move ${ID_2} user`)).toStartWith("Moved ");
  });

  test("a replacement may move to the scope of what it replaced", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: ACME_ORG, content: fact("Old") });
    fx.seed({ n: 2, scope: API_REPO, content: fact("New"), supersedes: 1 });

    expect(await fx.run(`move ${ID_2} org`)).toStartWith("Moved ");
  });

  test("refuses to move a replacement to a narrower scope than what it replaced", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: ACME_ORG, content: fact("Old") });
    fx.seed({ n: 2, scope: ACME_ORG, content: fact("New"), supersedes: 1 });

    const reply = await fx.run(`move ${ID_2} repo`);

    expect(reply).toBe(
      `Not moved: [${ID_2}] replaces [${ID_1}] in org:github.com/acme, which would show again in sessions that do not see repo:github.com/acme/api. Forget [${ID_1}] first, or move [${ID_2}] to a broader scope.`,
    );
    expect(fx.store.get(ID_2)?.scope).toEqual(ACME_ORG);
  });

  test("a replacement may move to the user scope whatever the scope of what it replaced", async () => {
    const fx = fixture();
    fx.seed({
      n: 1,
      scope: { level: "repo", id: "github.com/acme-labs/web" },
      content: fact("Old"),
    });
    fx.seed({ n: 2, scope: API_REPO, content: fact("New"), supersedes: 1 });

    expect(await fx.run(`move ${ID_2} user`)).toStartWith("Moved ");
  });

  test("refuses to move a replacement out of reach of what it replaced in another repo", async () => {
    const fx = fixture();
    fx.seed({
      n: 1,
      scope: { level: "repo", id: "github.com/acme-labs/web" },
      content: fact("Old"),
    });
    fx.seed({ n: 2, scope: API_REPO, content: fact("New"), supersedes: 1 });

    expect(await fx.run(`move ${ID_2} org`)).toStartWith(`Not moved: [${ID_2}] replaces [${ID_1}]`);
  });
});

describe("memory_command move and replaced product memories", () => {
  const fact = (title: string) => ({ kind: "fact", title, body: "" }) as const;
  const PAYMENTS = { level: "product", id: "payments" } as const;

  // api (org acme) and web (org acme-labs) are one product, so the product reaches two orgs.
  async function twoOrgProduct() {
    const fx = fixture();
    await fx.run("link payments");
    await fx.run("link payments", WEB_SESSION);
    fx.seed({ n: 1, scope: PAYMENTS, content: fact("Old") });
    fx.seed({ n: 2, scope: API_REPO, content: fact("New"), supersedes: 1 });
    return fx;
  }

  test("refuses to move a replacement of a product memory to an org, since the product spans orgs", async () => {
    const fx = await twoOrgProduct();

    expect(await fx.run(`move ${ID_2} org`)).toStartWith(`Not moved: [${ID_2}] replaces [${ID_1}]`);
    expect(fx.store.get(ID_2)?.scope).toEqual(API_REPO);
  });

  test("moves a replacement of a product memory to the product or to the user scope", async () => {
    const fx = await twoOrgProduct();

    expect(await fx.run(`move ${ID_2} product`)).toStartWith("Moved ");
    expect(await fx.run(`move ${ID_2} user`)).toStartWith("Moved ");
  });

  test("moves a replacement of a repo memory to the product the repo is in", async () => {
    const fx = fixture();
    await fx.run("link payments");
    fx.seed({ n: 1, scope: API_REPO, content: fact("Old") });
    fx.seed({ n: 2, scope: API_REPO, content: fact("New"), supersedes: 1 });

    expect(await fx.run(`move ${ID_2} product`)).toStartWith("Moved ");
  });
});

describe("memory_command usage", () => {
  test("an unknown subcommand gets the list of subcommands, setup included", async () => {
    const fx = fixture();

    const reply = await fx.run("frobnicate");

    expect(reply).toStartWith("Subcommands of /memory:");
    expect(reply).toContain("/memory setup");
    expect(reply).toContain("/memory org merge");
  });

  test("a malformed move gets its own usage and nothing moves", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: API_REPO, content: { kind: "fact", title: "t", body: "" } });

    expect(await fx.run(`move ${ID_1}`)).toStartWith("Not moved: expected /memory move <id>");
    expect(fx.store.get(ID_1)?.scope).toEqual(API_REPO);
  });
});

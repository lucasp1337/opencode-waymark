import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ACME_ORG,
  API_SESSION,
  COMMAND_CAPS,
  COMMAND_TIME,
  type CommandFixture,
  idNumber,
  LABS_ORG,
  useCommandFixture,
  WEB_SESSION,
} from "../../../../test/commands-fixture";
import { nodeFileSystem } from "../../store/fs";
import { mergeOrgs } from "./merge-orgs";

const fixture = useCommandFixture();

const MERGE = "org merge github.com/acme github.com/acme-labs";

async function withBothOrgs(): Promise<CommandFixture> {
  const fx = fixture();
  await fx.knowBothOrgs();
  return fx;
}

function registry(fx: CommandFixture): unknown {
  return JSON.parse(readFileSync(fx.registryFile, "utf8"));
}

describe("memory_command org merge", () => {
  test("moves every memory of the merged org to the kept org, keeping ids and bumping updated", async () => {
    const fx = await withBothOrgs();
    fx.seed({ n: 1, scope: LABS_ORG, content: { kind: "fact", title: "Old", body: "" } });
    fx.seed({
      n: 2,
      scope: LABS_ORG,
      content: { kind: "fact", title: "New", body: "" },
      supersedes: 1,
    });
    fx.seed({ n: 3, scope: ACME_ORG, content: { kind: "fact", title: "Already there", body: "" } });

    const reply = await fx.run(MERGE);

    expect(reply).toBe(
      "Merged org github.com/acme-labs into github.com/acme; memories moved: 2. Sessions in github.com/acme-labs's repos now use github.com/acme.",
    );
    expect(fx.store.inScopes([LABS_ORG])).toEqual([]);
    expect(fx.store.inScopes([ACME_ORG]).map((memory) => memory.id)).toEqual([
      idNumber(1),
      idNumber(2),
      idNumber(3),
    ]);
    expect(fx.store.get(idNumber(1))?.updated).toBe(COMMAND_TIME.toISOString());
    expect(fx.store.get(idNumber(3))?.updated).not.toBe(COMMAND_TIME.toISOString());
  });

  test("records the merged org as an alias of the kept one in the registry", async () => {
    const fx = await withBothOrgs();

    await fx.run(MERGE);

    expect(registry(fx)).toMatchObject({
      aliases: { "github.com/acme-labs": "github.com/acme" },
      orgs: { "github.com/acme": {}, "github.com/acme-labs": {} },
    });
  });

  test("toasts the merge", async () => {
    const fx = await withBothOrgs();

    await fx.run(MERGE);

    expect(fx.host.toasts).toContain(
      "waymark · merged org github.com/acme-labs into github.com/acme",
    );
  });

  test("sessions in the merged org's repos see the kept org's memories from then on", async () => {
    const fx = await withBothOrgs();
    fx.seed({ n: 1, scope: LABS_ORG, content: { kind: "fact", title: "From labs", body: "" } });
    fx.seed({ n: 2, scope: ACME_ORG, content: { kind: "fact", title: "From acme", body: "" } });

    await fx.run(MERGE);

    const listing = await fx.run("", WEB_SESSION);
    expect(listing).toContain("## org:github.com/acme (2)");
    expect(listing).toContain("From labs");
    expect(listing).toContain("From acme");
    expect(listing).not.toContain("## org:github.com/acme-labs");
  });

  test("a later session resolves the merged org's repos to the kept org", async () => {
    const fx = await withBothOrgs();
    await fx.run(MERGE);

    const later = fx.laterScopes();

    expect(await later.scopes.chainFor(WEB_SESSION)).toEqual([
      { level: "user" },
      ACME_ORG,
      { level: "repo", id: "github.com/acme-labs/web" },
    ]);
  });

  test("the kept org's own repos are unaffected", async () => {
    const fx = await withBothOrgs();
    await fx.run(MERGE);

    expect(await fx.scopes.chainFor(API_SESSION)).toContainEqual(ACME_ORG);
  });

  test("merging an org that has no memories still records the merge", async () => {
    const fx = await withBothOrgs();

    expect(await fx.run(MERGE)).toContain("memories moved: 0");
    expect(registry(fx)).toMatchObject({ aliases: { "github.com/acme-labs": "github.com/acme" } });
  });

  test("refuses an unknown org, names the known ones and changes nothing", async () => {
    const fx = await withBothOrgs();
    fx.seed({ n: 1, scope: LABS_ORG, content: { kind: "fact", title: "t", body: "" } });

    const reply = await fx.run("org merge github.com/acme github.com/nobody");

    expect(reply).toBe(
      "Not merged: unknown org github.com/nobody; known orgs: github.com/acme, github.com/acme-labs",
    );
    expect(fx.store.inScopes([LABS_ORG])).toHaveLength(1);
    expect(registry(fx)).not.toHaveProperty("aliases");
  });

  test("refuses to merge an org into itself", async () => {
    const fx = await withBothOrgs();

    expect(await fx.run("org merge github.com/acme github.com/acme")).toBe(
      "Not merged: an org cannot be merged into itself",
    );
  });

  test("refuses an org that was already merged", async () => {
    const fx = await withBothOrgs();
    await fx.run(MERGE);

    expect(await fx.run(MERGE)).toBe(
      "Not merged: github.com/acme-labs was already merged into github.com/acme",
    );
  });

  test("refuses to merge into an org that was itself merged away", async () => {
    const fx = await withBothOrgs();
    await fx.run(MERGE);

    expect(await fx.run("org merge github.com/acme-labs github.com/acme")).toBe(
      "Not merged: github.com/acme-labs was merged into github.com/acme; merge into that org instead",
    );
  });

  test("refuses a merge that would overflow the kept org's cap and moves nothing", async () => {
    const fx = await withBothOrgs();
    fx.seed({
      n: 1,
      scope: ACME_ORG,
      content: { kind: "rule", title: "Sign commits", body: "x".repeat(150), why: "policy" },
    });
    fx.seed({
      n: 2,
      scope: LABS_ORG,
      content: { kind: "rule", title: "Use UTC", body: "y".repeat(60), why: "logs" },
    });

    const reply = await fx.run(MERGE);

    expect(reply).toStartWith(
      "Not merged: rule and preference memories in org:github.com/acme are capped at 50 tokens; 46 are used and the memory needs 21.",
    );
    expect(reply).toEndWith(
      [
        `- [${idNumber(1)}] rule · org:github.com/acme · Sign commits (46 tokens)`,
        "Arriving:",
        `- [${idNumber(2)}] rule · org:github.com/acme-labs · Use UTC (21 tokens)`,
      ].join("\n"),
    );
    expect(fx.store.inScopes([LABS_ORG])).toHaveLength(1);
    expect(registry(fx)).not.toHaveProperty("aliases");
    expect(fx.host.toasts.filter((toast) => toast.includes("merged"))).toEqual([]);
  });

  test("the memories together must fit the kept org's cap, not just each alone", async () => {
    const fx = await withBothOrgs();
    for (const n of [1, 2]) {
      fx.seed({
        n,
        scope: LABS_ORG,
        content: { kind: "rule", title: `Rule ${n}`, body: "x".repeat(100), why: "policy" },
      });
    }

    const reply = await fx.run(MERGE);

    expect(reply).toStartWith("Not merged: rule and preference memories");
    expect(reply).toContain(`- [${idNumber(1)}] rule · org:github.com/acme-labs · Rule 1`);
    expect(reply).toContain(`- [${idNumber(2)}] rule · org:github.com/acme-labs · Rule 2`);
    expect(fx.store.inScopes([LABS_ORG])).toHaveLength(2);
  });

  test("a replaced rule arriving with its replacement takes no room", async () => {
    const fx = await withBothOrgs();
    fx.seed({
      n: 1,
      scope: ACME_ORG,
      content: { kind: "rule", title: "Sign commits", body: "x".repeat(150), why: "policy" },
    });
    fx.seed({
      n: 2,
      scope: LABS_ORG,
      content: { kind: "rule", title: "Use UTC", body: "y".repeat(60), why: "logs" },
    });
    fx.seed({
      n: 3,
      scope: LABS_ORG,
      content: { kind: "rule", title: "A", body: "b", why: "w" },
      supersedes: 2,
    });

    expect(await fx.run(MERGE)).toStartWith("Merged org");
  });

  test("refuses a registry it cannot read and changes nothing", async () => {
    const fx = fixture();
    await fx.knowBothOrgs();
    fx.seed({ n: 1, scope: LABS_ORG, content: { kind: "fact", title: "t", body: "" } });
    await Bun.write(fx.registryFile, "{ not json");

    expect(await fx.run(MERGE)).toStartWith(
      `Not merged: registry ${fx.registryFile} is not valid JSON`,
    );
    expect(fx.store.inScopes([LABS_ORG])).toHaveLength(1);
  });

  test("a malformed merge gets its usage", async () => {
    const fx = await withBothOrgs();

    expect(await fx.run("org merge github.com/acme")).toStartWith(
      "Not merged: expected /memory org merge",
    );
  });
});

describe("an org merge interrupted after the memories moved", () => {
  const merge = { into: ACME_ORG.id, from: LABS_ORG.id };

  async function interrupted(fx: CommandFixture) {
    fx.seed({ n: 1, scope: LABS_ORG, content: { kind: "fact", title: "t", body: "" } });
    const deps = {
      host: fx.host,
      store: fx.store,
      now: () => COMMAND_TIME,
      caps: () => COMMAND_CAPS,
      registryFile: fx.registryFile,
      fs: {
        ...nodeFileSystem,
        // The registry is fine while the merge is checked and damaged once the memories moved.
        readText: (path: string) =>
          fx.store.inScopes([LABS_ORG]).length === 0 ? "{ not json" : nodeFileSystem.readText(path),
      },
    };
    return await mergeOrgs(deps, merge);
  }

  test("says the memories moved and how to finish the merge", async () => {
    const fx = await withBothOrgs();

    expect(await interrupted(fx)).toBe(
      "Memories moved to github.com/acme but the merge was not recorded; run /memory org merge github.com/acme github.com/acme-labs again.",
    );
    expect(fx.store.get(idNumber(1))?.scope).toEqual(ACME_ORG);
  });

  test("logs why the merge was not recorded", async () => {
    const fx = await withBothOrgs();

    await interrupted(fx);

    expect(fx.host.logs).toContainEqual({
      level: "warn",
      msg: "org merge not recorded",
      data: {
        ...merge,
        error: expect.stringContaining(`registry ${fx.registryFile} is not valid JSON (`),
      },
    });
  });

  test("running the merge again records it without moving anything twice", async () => {
    const fx = await withBothOrgs();
    await interrupted(fx);
    expect(registry(fx)).not.toHaveProperty("aliases");

    expect(await fx.run(MERGE)).toContain("memories moved: 0");
    expect(registry(fx)).toMatchObject({ aliases: { [LABS_ORG.id]: ACME_ORG.id } });
    expect(fx.store.get(idNumber(1))?.scope).toEqual(ACME_ORG);
  });
});

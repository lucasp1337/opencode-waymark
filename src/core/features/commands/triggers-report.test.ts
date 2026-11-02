import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  API_REPO,
  HOME,
  idNumber,
  useCommandFixture,
  WEB_SESSION,
} from "../../../../test/commands-fixture";
import { useTempDirs } from "../../../../test/temp-dir";
import { err } from "../../model/result";
import { createCheckoutRecorder } from "../../scope/checkouts";
import { nodeFileSystem } from "../../store/fs";
import { repoTriggersSection } from "./repo-triggers";

const fixture = useCommandFixture();
const tempDir = useTempDirs();

const API = "github.com/acme/api";
const WEB = "github.com/acme-labs/web";
const PAYMENTS = { level: "product", id: "payments" } as const;

const gotcha = (triggers: object) =>
  ({ kind: "gotcha", title: "Careful", body: "b", triggers }) as const;

async function payments() {
  const fx = fixture();
  await fx.run("link payments");
  await fx.run("link payments", WEB_SESSION);
  return fx;
}

describe("memory_command triggers", () => {
  test("groups memories by field, then by value, each with id, kind, scope and title", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: API_REPO, content: gotcha({ paths: ["db/**"], tools: ["bash"] }) });
    fx.seed({ n: 2, scope: API_REPO, content: gotcha({ paths: ["a/**"] }) });

    const report = await fx.run("triggers");

    expect(report).toBe(
      [
        "## paths",
        "### a/**",
        `- [${idNumber(2)}] gotcha · repo:${API} · Careful (2026-03-01)`,
        "### db/**",
        `- [${idNumber(1)}] gotcha · repo:${API} · Careful (2026-03-01)`,
        "",
        "## tools",
        "### bash",
        `- [${idNumber(1)}] gotcha · repo:${API} · Careful (2026-03-01)`,
        "",
        "## repos",
        "This session is not in a product, so no memory can target a repo.",
      ].join("\n"),
    );
  });

  test("a field argument shows only that field", async () => {
    const fx = fixture();
    fx.seed({ n: 1, scope: API_REPO, content: gotcha({ paths: ["db/**"], tools: ["bash"] }) });

    const report = await fx.run("triggers tools");

    expect(report).toStartWith("## tools");
    expect(report).not.toContain("## paths");
  });

  test("says so when no memory has triggers", async () => {
    const fx = fixture();

    expect(await fx.run("triggers paths")).toBe(
      "No memory reachable from this session has triggers.paths.",
    );
  });

  test("lists nothing for a session outside any repository with no triggered memory", async () => {
    const fx = fixture();

    expect(await fx.run("triggers keywords")).toBe(
      "No memory reachable from this session has triggers.keywords.",
    );
  });

  test("rejects an unknown field with the usage", async () => {
    const fx = fixture();

    expect(await fx.run("triggers colour")).toBe(
      "Expected /memory triggers [paths|commands|tools|keywords|repos].",
    );
  });

  test("repos outside a product says so", async () => {
    const fx = fixture();

    expect(await fx.run("triggers repos")).toBe(
      "## repos\nThis session is not in a product, so no memory can target a repo.",
    );
  });
});

describe("memory_command triggers repos", () => {
  const boundary = {
    kind: "decision",
    title: "web owns the cart",
    body: "b",
    why: "w",
    triggers: { repos: [WEB] },
  } as const;

  test("shows every member with its checkout, untargeted ones included", async () => {
    const fx = await payments();
    const root = tempDir();
    mkdirSync(join(root, ".git"));
    const record = createCheckoutRecorder({
      fs: nodeFileSystem,
      registryFile: fx.registryFile,
      now: () => new Date(0),
      log: () => undefined,
    });
    await record(WEB, root);
    await record(API, `${HOME}/src/api`);
    fx.seed({ n: 1, scope: PAYMENTS, content: boundary });

    const report = await fx.run("triggers repos");

    expect(report).toBe(
      [
        "## repos (product payments)",
        `### ${API} — no checkout seen`,
        "(no memory targets it)",
        `### ${WEB} — ${root}`,
        `- [${idNumber(1)}] decision · product:payments · web owns the cart (2026-03-01)`,
      ].join("\n"),
    );
  });

  test("lists memories whose repo left the product in their own group", async () => {
    const fx = await payments();
    fx.seed({ n: 1, scope: PAYMENTS, content: boundary });
    await fx.run("unlink", WEB_SESSION);

    const report = await fx.run("triggers repos");

    expect(report).toContain(`### ${WEB} — left the product, no longer fires\n- [${idNumber(1)}]`);
    expect(report).toContain(`### ${API} — no checkout seen`);
  });

  test("says so when the product's repos cannot be read", async () => {
    const fx = await payments();
    const registry = JSON.parse(nodeFileSystem.readText(fx.registryFile) ?? "{}");
    nodeFileSystem.writeAtomic(fx.registryFile, JSON.stringify({ ...registry, checkouts: [] }));

    const report = await fx.run("triggers repos");

    expect(report).toContain("the repos of product payments could not be read (registry");
  });
});

describe("repoTriggersSection", () => {
  test("says so when the registry cannot give the product's repos", async () => {
    const fx = await payments();
    const chain = await fx.scopes.chainFor("ses_api");

    const section = await repoTriggersSection(
      {
        productRepos: () => err("bad json"),
        fs: nodeFileSystem,
        registryFile: fx.registryFile,
        home: HOME,
        host: { log: () => undefined },
      },
      chain,
      [],
    );

    expect(section).toBe("## repos\nthe repos of product payments could not be read (bad json).");
  });
});

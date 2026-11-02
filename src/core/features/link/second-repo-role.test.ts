import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createFakeHost } from "../../../../test/fake-host";
import { fakeRepos } from "../../../../test/fake-repos";
import { memoryId } from "../../../../test/memory-id";
import { useTempDirs } from "../../../../test/temp-dir";
import { validContent } from "../../../../test/valid-content";
import { type Memory, newMemory } from "../../model/memory";
import { err, ok, type Result } from "../../model/result";
import type { ScopeRef } from "../../model/scope";
import type { ToolCallInfo } from "../../port";
import { linkRepos } from "../../scope/products";
import { nodeFileSystem } from "../../store/fs";
import { createRepoIds } from "./repo-ids";
import { createRepoWatch } from "./repo-watch";
import { createSecondRepoHints } from "./second-repo";
import { createTouchedRoots } from "./touched-repos";

const tempDir = useTempDirs();

const API = "github.com/acme/api";
const WEB = "github.com/acme/web";
const PRODUCT: ScopeRef = { level: "product", id: "payments" };
const ORIGINS = new Map([
  ["/work/api", "git@github.com:acme/api.git"],
  ["/work/web", "git@github.com:acme/web.git"],
]);
const SESSION = "ses_a";
const NOTE = `waymark · Nothing says what web owns yet; if the user explains its role, save it with triggers.repos ["${WEB}"].`;

function memoryAimedAt(repos: string[], scope: ScopeRef = PRODUCT): Memory {
  return newMemory(
    validContent({ kind: "fact", title: "Web owns carts", body: "b", triggers: { repos } }),
    { id: memoryId("01JB8Z6Q4R3M2N1P0V9W8X0001"), scope, now: new Date(0) },
  );
}

interface Setup {
  readonly stored?: Memory[];
  readonly members?: Result<readonly string[], string>;
  readonly storeThrows?: boolean;
}

async function setup(options: Setup = {}) {
  const host = createFakeHost();
  const repos = fakeRepos(ORIGINS);
  const registryFile = join(tempDir(), "registry.json");
  await linkRepos(nodeFileSystem, registryFile, { repos: [API, WEB], product: "payments" });
  const checkouts: string[][] = [];
  const hints = createSecondRepoHints({
    recallScope: () =>
      Promise.resolve({
        chain: [{ level: "user" }, PRODUCT, { level: "repo", id: API }],
        directory: "/work/api",
      }),
    repoWatch: createRepoWatch({
      repoIds: createRepoIds({ originUrl: repos.originUrl, log: host.log }),
      touchedRoots: createTouchedRoots({ fs: repos.fs, log: host.log }),
    }),
    store: {
      inScopes: () => {
        if (options.storeThrows) {
          throw new Error("database is locked");
        }
        return options.stored ?? [];
      },
    },
    productRepos: () => options.members ?? ok([API, WEB]),
    fs: repos.fs,
    registryFile,
    recordCheckout: (repo, root) => {
      checkouts.push([repo, root]);
      return Promise.resolve();
    },
    log: host.log,
  });
  return { hints, logs: host.logs, checkouts };
}

function call(...paths: string[]): ToolCallInfo {
  return { sessionID: SESSION, tool: "read", args: {}, touchedPaths: paths, appendable: true };
}

// A repo is identified off the call that touched it, so the line rides on a later call.
async function touchWeb(hints: Awaited<ReturnType<typeof setup>>["hints"]): Promise<string[]> {
  const outputs = [await hints.onToolAfter(call("/work/web/src/a.ts"))];
  await new Promise<void>((resolve) => setImmediate(resolve));
  outputs.push(await hints.onToolAfter(call("/work/web/src/b.ts")));
  return outputs.filter((output) => output !== null);
}

describe("the role suggestion in the product hint", () => {
  test("names the sibling and its full id when no memory is aimed at it", async () => {
    const { hints } = await setup();

    expect(await touchWeb(hints)).toEqual([NOTE]);
  });

  test("is absent when a product memory is aimed at the sibling", async () => {
    const { hints } = await setup({ stored: [memoryAimedAt([WEB])] });

    expect(await touchWeb(hints)).toEqual([]);
  });

  test("is still given when the memory is aimed at another repo", async () => {
    const { hints } = await setup({ stored: [memoryAimedAt([API])] });

    expect(await touchWeb(hints)).toEqual([NOTE]);
  });

  test("is given when the only memory aimed at the sibling is not at product scope", async () => {
    const { hints } = await setup({
      stored: [memoryAimedAt([WEB], { level: "repo", id: API })],
    });

    expect(await touchWeb(hints)).toEqual([NOTE]);
  });

  test("comes once per repo and session", async () => {
    const { hints } = await setup();
    await touchWeb(hints);

    expect(await hints.onToolAfter(call("/work/web/src/c.ts"))).toBeNull();
  });

  test("comes again in a later session", async () => {
    const { hints } = await setup();
    await touchWeb(hints);
    hints.forget(SESSION);

    expect(await touchWeb(hints)).toEqual([NOTE]);
  });

  test("is absent for a repo that is not a member of the product", async () => {
    const { hints } = await setup({ members: ok([API]) });

    expect(await touchWeb(hints)).toEqual([]);
  });

  test("is absent, and logged once, when the registry cannot be read", async () => {
    const { hints, logs } = await setup({ members: err("bad json") });

    expect(await touchWeb(hints)).toEqual([]);
    await hints.onToolAfter(call("/work/web/src/c.ts"));
    expect(logs.filter((entry) => entry.msg === "role suggestion not checked")).toHaveLength(1);
  });

  test("is absent when the store cannot be read, logged once, and the rest of the call still runs", async () => {
    const { hints, logs, checkouts } = await setup({ storeThrows: true });

    expect(await touchWeb(hints)).toEqual([]);
    expect(logs.filter((entry) => entry.msg === "role suggestion not checked")).toHaveLength(1);
    expect(checkouts).toEqual([[WEB, "/work/web"]]);
  });
});

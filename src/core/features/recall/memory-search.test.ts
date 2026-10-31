import { describe, expect, test } from "bun:test";
import { fakeEmbedder } from "../../../../test/fake-embedder";
import { embedderIn, searchMemory, useSearchFixture } from "../../../../test/search-fixture";
import type { Memory } from "../../model/memory";
import type { ScopeChain, ScopeRef } from "../../model/scope";
import type { SessionScopes } from "../../scope/session-scopes";
import type { Embedder } from "../../store/embedder";
import { memoryLine } from "../memory-line";
import { memorySearchTool } from "./memory-search";

const USER: ScopeRef = { level: "user" };
const ORG: ScopeRef = { level: "org", id: "github.com/acme" };
const REPO: ScopeRef = { level: "repo", id: "github.com/acme/api" };
const OTHER_REPO: ScopeRef = { level: "repo", id: "github.com/acme/web" };
const SESSION = "ses_1";

const ROOT_RULE = ["repository root", "koreňového adresára"];

const rootRule = {
  title: "Deploy from the repository root",
  body: "Run deploy.sh only at the top level.",
};

const fixture = useSearchFixture();

function ready(embedder: Embedder) {
  return embedderIn({ status: "ready", embedder });
}

// A session whose chain is user, org and repo.
const scopes: SessionScopes = {
  chainFor: (): Promise<ScopeChain> => Promise.resolve([USER, ORG, REPO]),
};

// By default meaning is available but knows nothing, so results come from words and carry no note.
function searchTool(embedder = ready(fakeEmbedder([["a phrase no test uses"]]))) {
  const { host, store, retriever } = fixture(embedder);
  host.registerTool(memorySearchTool({ scopes, retriever }));
  const search = (input: unknown) => host.callTool("memory_search", input, SESSION);
  const saveAll = (memories: readonly Memory[]) => {
    for (const memory of memories) {
      store.save(memory);
    }
  };
  return { search, saveAll };
}

function hitLine(memory: Memory): string {
  return `- ${memoryLine(memory)}`;
}

describe("memory_search when meaning is not available", () => {
  test("says results are by words only while the model is loading", async () => {
    const { search, saveAll } = searchTool(embedderIn({ status: "loading" }));
    const backups = searchMemory(1, { title: "Backups", body: "Nightly backups run at 02:00." });
    saveAll([backups]);

    expect(await search({ query: "backups" })).toBe(
      `${hitLine(backups)}\nMatched by words only; meaning-based search is loading.`,
    );
  });

  test("says results are by words only when the model is unavailable", async () => {
    const { search } = searchTool(embedderIn({ status: "unavailable", reason: "offline" }));

    expect(await search({ query: "backups" })).toBe(
      "No memories match.\nMatched by words only; meaning-based search is unavailable.",
    );
  });
});

describe("memory_search", () => {
  test("lists a hit as a dash and the memory's one-line form with its updated date", async () => {
    const { search, saveAll } = searchTool();
    const backups = searchMemory(1, { title: "Backups", body: "Nightly backups run at 02:00." });
    saveAll([backups]);

    expect(await search({ query: "backups" })).toBe(
      "- [01JB8Z6Q4R3M2N1P0V9W8X0001] fact · user · Backups (2026-03-01)",
    );
  });

  test("says so when nothing matches", async () => {
    const { search, saveAll } = searchTool();
    saveAll([searchMemory(1, { title: "Backups", body: "Nightly backups." })]);

    expect(await search({ query: "kubernetes" })).toBe("No memories match.");
  });

  test("finds a memory by meaning in another language once the model is ready", async () => {
    const { search, saveAll } = searchTool(ready(fakeEmbedder([ROOT_RULE])));
    const memory = searchMemory(1, rootRule);
    saveAll([memory]);

    expect(await search({ query: "Skript spúšťaj z koreňového adresára" })).toBe(hitLine(memory));
  });

  test("returns at most ten hits", async () => {
    const { search, saveAll } = searchTool();
    saveAll(
      Array.from({ length: 12 }, (_, n) =>
        searchMemory(n + 1, { title: `Backups ${n}`, body: "x" }),
      ),
    );

    expect((await search({ query: "backups" })).split("\n")).toHaveLength(10);
  });

  test("only returns the requested kinds", async () => {
    const { search, saveAll } = searchTool();
    const fact = searchMemory(1, { title: "Backups fact", body: "x" });
    const preference = searchMemory(2, {
      title: "Backups preference",
      body: "x",
      kind: "preference",
    });
    saveAll([fact, preference]);

    expect(await search({ query: "backups", kinds: ["preference"] })).toBe(hitLine(preference));
  });

  test("finds a requested kind even when ten other kinds rank above it", async () => {
    const { search, saveAll } = searchTool();
    const facts = Array.from({ length: 12 }, (_, n) =>
      searchMemory(n + 1, { title: "Backups backups backups", body: "backups" }),
    );
    const preference = searchMemory(20, { title: "Backups", body: "x", kind: "preference" });
    saveAll([...facts, preference]);

    expect(await search({ query: "backups", kinds: ["preference"] })).toBe(hitLine(preference));
  });

  test("only returns memories of the requested scope levels", async () => {
    const { search, saveAll } = searchTool();
    const user = searchMemory(1, { title: "Backups for me", body: "x", scope: USER });
    const repo = searchMemory(2, { title: "Backups for api", body: "x", scope: REPO });
    saveAll([user, repo]);

    expect(await search({ query: "backups", scopes: ["repo"] })).toBe(hitLine(repo));
  });

  test("never returns memories outside the session's chain", async () => {
    const { search, saveAll } = searchTool();
    saveAll([searchMemory(1, { title: "Backups elsewhere", body: "x", scope: OTHER_REPO })]);

    expect(await search({ query: "backups" })).toBe("No memories match.");
  });

  test("an empty filter list restricts nothing", async () => {
    const { search, saveAll } = searchTool();
    const memory = searchMemory(1, { title: "Backups", body: "x" });
    saveAll([memory]);

    expect(await search({ query: "backups", kinds: [], scopes: [] })).toBe(hitLine(memory));
  });

  test("explains a missing query", async () => {
    const { search } = searchTool();

    expect(await search({ kinds: ["fact"] })).toBe(
      "Not searched: query must be a non-empty string",
    );
  });

  test("explains a blank query", async () => {
    const { search } = searchTool();

    expect(await search({ query: "   " })).toBe("Not searched: query must be a non-empty string");
  });

  test("explains a kind that does not exist", async () => {
    const { search } = searchTool();

    expect(await search({ query: "backups", kinds: ["note"] })).toBe(
      "Not searched: kinds must be a list of rule, preference, fact, decision, gotcha, reference",
    );
  });

  test("explains a scope level that does not exist", async () => {
    const { search } = searchTool();

    expect(await search({ query: "backups", scopes: "repo" })).toBe(
      "Not searched: scopes must be a list of user, org, product, repo",
    );
  });

  test("lists every problem at once", async () => {
    const { search } = searchTool();

    expect(await search({ kinds: ["note"], scopes: ["team"] })).toBe(
      "Not searched: query must be a non-empty string; kinds must be a list of rule, preference, fact, decision, gotcha, reference; scopes must be a list of user, org, product, repo",
    );
  });

  test("explains input that is not an object", async () => {
    const { search } = searchTool();

    expect(await search("backups")).toBe("Not searched: query must be a non-empty string");
  });
});

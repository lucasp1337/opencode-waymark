import { describe, expect, test } from "bun:test";
import { fakeEmbedder } from "../../../../test/fake-embedder";
import { embedderIn, searchMemory, useSearchFixture } from "../../../../test/search-fixture";
import type { Memory } from "../../model/memory";
import type { ScopeRef } from "../../model/scope";
import type { Embedder } from "../../store/embedder";
import type { VectorIndex } from "../../store/vector-index";
import { createLazyEmbedder } from "./embeddings/lazy-embedder";
import { createRetriever, type Retriever } from "./retriever";

const USER: ScopeRef = { level: "user" };
const REPO: ScopeRef = { level: "repo", id: "github.com/acme/api" };
const OTHER_REPO: ScopeRef = { level: "repo", id: "github.com/acme/web" };

// The same rule in English and Slovak: no word in common, one meaning.
const ROOT_RULE = ["repository root", "koreňového adresára"];
const BACKUPS = ["backups run", "Zálohy bežia"];

const rootRuleText = {
  title: "Deploy from the repository root",
  body: "Run deploy.sh only at the top level.",
};
const rootRule = searchMemory(1, rootRuleText);
const backups = searchMemory(2, { title: "Backups", body: "Nightly backups run at 02:00." });

const SLOVAK_QUERY = "Skript spúšťaj z koreňového adresára";

const fixture = useSearchFixture();

function ready(embedder: Embedder) {
  return embedderIn({ status: "ready", embedder });
}

function saveAll(store: { save(memory: Memory): void }, memories: readonly Memory[]): void {
  for (const memory of memories) {
    store.save(memory);
  }
}

function ids(memories: readonly Memory[]): string[] {
  return memories.map((memory) => memory.id);
}

// The memories a search finds, for tests that only care about those.
async function found(
  retriever: Retriever,
  text: string,
  options: { scopes?: readonly ScopeRef[]; limit?: number } = {},
): Promise<string[]> {
  const { scopes = [USER], limit = 5 } = options;
  return ids((await retriever.search({ text, scopes, limit })).memories);
}

describe("createRetriever", () => {
  test("finds a memory by meaning in another language when the model is ready", async () => {
    const { store, retriever } = fixture(ready(fakeEmbedder([ROOT_RULE, BACKUPS])));
    saveAll(store, [backups, rootRule]);

    expect(await found(retriever, SLOVAK_QUERY)).toEqual([rootRule.id]);
  });

  test("does not return a memory whose meaning is not close, even as the nearest one", async () => {
    const { store, retriever } = fixture(ready(fakeEmbedder([ROOT_RULE, BACKUPS])));
    saveAll(store, [backups]);

    expect(await found(retriever, SLOVAK_QUERY)).toEqual([]);
  });

  test("ranks the semantically closest memory first", async () => {
    const { store, retriever } = fixture(ready(fakeEmbedder([ROOT_RULE, BACKUPS])));
    saveAll(store, [rootRule, backups]);

    expect((await found(retriever, "when do backups run"))[0]).toBe(backups.id);
  });

  test("a memory both rankings find beats one only meaning finds", async () => {
    const slovakBackups = searchMemory(1, { title: "Zálohy", body: "Zálohy bežia každú noc." });
    const { store, retriever } = fixture(ready(fakeEmbedder([ROOT_RULE, BACKUPS])));
    saveAll(store, [slovakBackups, backups]);

    expect(await found(retriever, "when do backups run")).toEqual([backups.id, slovakBackups.id]);
  });

  test("reports that meaning was used", async () => {
    const { store, retriever } = fixture(ready(fakeEmbedder([ROOT_RULE])));
    saveAll(store, [rootRule]);

    const result = await retriever.search({ text: SLOVAK_QUERY, scopes: [USER], limit: 5 });

    expect(result.meaning).toBe("used");
  });
});

describe("a search while the model is not ready", () => {
  test("finds by words only and says the model is loading", async () => {
    const { store, retriever } = fixture(embedderIn({ status: "loading" }));
    saveAll(store, [rootRule, backups]);

    const byWords = await retriever.search({ text: "nightly backups", scopes: [USER], limit: 5 });
    const byMeaning = await retriever.search({ text: SLOVAK_QUERY, scopes: [USER], limit: 5 });

    expect(ids(byWords.memories)).toEqual([backups.id]);
    expect(byWords.meaning).toBe("loading");
    expect(byMeaning.memories).toEqual([]);
  });

  test("finds by words only and says the model is unavailable", async () => {
    const { store, retriever } = fixture(embedderIn({ status: "unavailable", reason: "offline" }));
    saveAll(store, [rootRule, backups]);

    const result = await retriever.search({ text: "nightly backups", scopes: [USER], limit: 5 });

    expect(ids(result.memories)).toEqual([backups.id]);
    expect(result.meaning).toBe("unavailable");
  });

  test("a search starts the model load and the next one after it finishes uses meaning", async () => {
    const load = Promise.withResolvers<Embedder>();
    const lazy = createLazyEmbedder(
      () => load.promise,
      () => undefined,
    );
    const { store, retriever } = fixture(lazy);
    saveAll(store, [rootRule]);

    const during = await retriever.search({ text: SLOVAK_QUERY, scopes: [USER], limit: 5 });
    load.resolve(fakeEmbedder([ROOT_RULE]));
    await new Promise((resolve) => setImmediate(resolve));
    const after = await retriever.search({ text: SLOVAK_QUERY, scopes: [USER], limit: 5 });

    expect([during.meaning, ids(during.memories)]).toEqual(["loading", []]);
    expect([after.meaning, ids(after.memories)]).toEqual(["used", [rootRule.id]]);
  });
});

describe("a search where meaning fails", () => {
  test("falls back to words, says meaning is unavailable and logs when embedding fails", async () => {
    const broken: Embedder = { model: "broken", embed: () => Promise.reject(new Error("oom")) };
    const { store, retriever, host } = fixture(ready(broken));
    saveAll(store, [rootRule, backups]);

    const result = await retriever.search({ text: "nightly backups", scopes: [USER], limit: 5 });

    expect(ids(result.memories)).toEqual([backups.id]);
    expect(result.meaning).toBe("unavailable");
    expect(host.logs).toEqual([
      {
        level: "warn",
        msg: "semantic search failed, using text matching only",
        data: { error: "Error: oom" },
      },
    ]);
  });

  test("falls back to words when the embedder returns no query vector", async () => {
    const empty: Embedder = { model: "empty", embed: () => Promise.resolve([]) };
    const { store, retriever, host } = fixture(ready(empty));
    saveAll(store, [rootRule, backups]);

    expect(await found(retriever, "nightly backups")).toEqual([backups.id]);
    expect(host.logs).toHaveLength(1);
  });

  test("falls back to words rather than comparing vectors of different sizes", async () => {
    const { store, host } = fixture(ready(fakeEmbedder([ROOT_RULE, BACKUPS])));
    saveAll(store, [rootRule, backups]);
    const wrongSize: VectorIndex = {
      vectorsFor: () => Promise.resolve(new Map([[rootRule.id, Float32Array.of(1)]])),
      close: () => undefined,
    };
    const retriever = createRetriever({
      store,
      vectors: wrongSize,
      embedder: ready(fakeEmbedder([ROOT_RULE, BACKUPS])),
      log: host.log,
    });

    const result = await retriever.search({ text: SLOVAK_QUERY, scopes: [USER], limit: 5 });

    expect(result.memories).toEqual([]);
    expect(result.meaning).toBe("unavailable");
    expect(host.logs[0]?.data).toEqual({
      error: "EmbeddingShapeError: embedder returned vectors of 2 and 1 numbers to compare",
    });
  });
});

describe("vectors", () => {
  test("embeds each memory once across searches", async () => {
    const embedder = fakeEmbedder([ROOT_RULE]);
    const { store, retriever } = fixture(ready(embedder));
    saveAll(store, [rootRule, backups]);

    await found(retriever, SLOVAK_QUERY);
    await found(retriever, SLOVAK_QUERY);

    expect(embedder.calls.map((texts) => texts.length)).toEqual([1, 2, 1]);
  });

  test("embeds a memory again after its body changes", async () => {
    const embedder = fakeEmbedder([ROOT_RULE]);
    const { store, retriever } = fixture(ready(embedder));
    saveAll(store, [rootRule, backups]);
    await found(retriever, SLOVAK_QUERY);

    store.save({ ...backups, body: "Nightly backups now run at 03:00." });
    await found(retriever, SLOVAK_QUERY);

    expect(embedder.calls.at(-1)).toEqual(["Backups\nNightly backups now run at 03:00."]);
  });
});

describe("scopes, kinds and limits", () => {
  test("only returns memories of the given scopes", async () => {
    const inRepo = searchMemory(3, { ...rootRuleText, scope: REPO });
    const inOtherRepo = searchMemory(4, { ...rootRuleText, scope: OTHER_REPO });
    const { store, retriever } = fixture(ready(fakeEmbedder([ROOT_RULE])));
    saveAll(store, [inRepo, inOtherRepo]);

    expect(await found(retriever, SLOVAK_QUERY, { scopes: [USER, REPO] })).toEqual([inRepo.id]);
  });

  test("returns nothing for a chain without memories", async () => {
    const embedder = fakeEmbedder([ROOT_RULE]);
    const { retriever } = fixture(ready(embedder));

    expect(await found(retriever, SLOVAK_QUERY)).toEqual([]);
    expect(embedder.calls).toEqual([]);
  });

  test("cuts the fused list to the limit", async () => {
    const { store, retriever } = fixture(ready(fakeEmbedder([ROOT_RULE])));
    saveAll(store, [rootRule, searchMemory(3, rootRuleText), searchMemory(4, rootRuleText)]);

    expect(await found(retriever, SLOVAK_QUERY, { limit: 2 })).toHaveLength(2);
  });

  test("ranks at most twenty memories by meaning", async () => {
    const { store, retriever } = fixture(ready(fakeEmbedder([ROOT_RULE])));
    saveAll(
      store,
      Array.from({ length: 30 }, (_, n) => searchMemory(n + 1, rootRuleText)),
    );

    expect(await found(retriever, SLOVAK_QUERY, { limit: 100 })).toHaveLength(20);
  });

  test("a kind outranked by more than twenty others is still found by meaning", async () => {
    const { store, retriever } = fixture(ready(fakeEmbedder([ROOT_RULE])));
    const facts = Array.from({ length: 25 }, (_, n) => searchMemory(n + 1, rootRuleText));
    const preference = searchMemory(99, { ...rootRuleText, kind: "preference" });
    saveAll(store, [...facts, preference]);

    const result = await retriever.search({
      text: SLOVAK_QUERY,
      scopes: [USER],
      kinds: ["preference"],
      limit: 5,
    });

    expect(ids(result.memories)).toEqual([preference.id]);
  });

  test("a kind outranked by more than twenty others is still found by words", async () => {
    const { store, retriever } = fixture(embedderIn({ status: "loading" }));
    const facts = Array.from({ length: 25 }, (_, n) =>
      searchMemory(n + 1, { title: "Backups backups backups", body: "backups backups" }),
    );
    const preference = searchMemory(99, { title: "Backups", body: "x", kind: "preference" });
    saveAll(store, [...facts, preference]);

    const result = await retriever.search({
      text: "backups",
      scopes: [USER],
      kinds: ["preference"],
      limit: 5,
    });

    expect(ids(result.memories)).toEqual([preference.id]);
  });

  test("returns several kinds when several are asked for", async () => {
    const { store, retriever } = fixture(embedderIn({ status: "loading" }));
    const fact = searchMemory(1, { title: "Backups", body: "x" });
    const preference = searchMemory(2, { title: "Backups", body: "x", kind: "preference" });
    saveAll(store, [fact, preference]);

    const result = await retriever.search({
      text: "backups",
      scopes: [USER],
      kinds: ["fact", "preference"],
      limit: 5,
    });

    expect(ids(result.memories)).toEqual([fact.id, preference.id]);
  });

  test("an empty kind filter matches nothing, by words or by meaning", async () => {
    const { store, retriever } = fixture(ready(fakeEmbedder([ROOT_RULE])));
    saveAll(store, [rootRule]);

    const result = await retriever.search({
      text: "Deploy from the repository root",
      scopes: [USER],
      kinds: [],
      limit: 5,
    });

    expect(result.memories).toEqual([]);
  });
});

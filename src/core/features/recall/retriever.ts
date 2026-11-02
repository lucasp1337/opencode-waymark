import { type Memory, titleAndBody } from "../../model/memory";
import { wordsOf } from "../../model/words";
import type { HostPort } from "../../port";
import type { RelatedQuery } from "../../store/cache";
import { type Embedder, EmbeddingShapeError } from "../../store/embedder";
import type { MemoryStore } from "../../store/memory-store";
import type { VectorIndex } from "../../store/vector-index";
import type { EmbedderState, LazyEmbedder } from "./embeddings/lazy-embedder";
import { fuseRankings } from "./rank-fusion";
import { wordShare } from "./word-share";

const RANKING_DEPTH = 20;

// Calibrated on a small sample of English developer notes: unrelated notes score below it,
// paraphrases above. Notes on the same topic may land above it, which is intended: a spurious
// candidate costs one extra call. Re-tune with test/live/bench/similarity-pairs.ts.
export const MIN_SIMILARITY = 0.862;

// A stored memory counts as a duplicate by words when it repeats at least this share of the new
// text's distinct words; sharing a single common word proves nothing. Calibrated with
// test/live/bench/similarity-pairs.ts.
export const MIN_WORD_SHARE = 0.5;

// How long a save waits for a model that is still loading before checking for duplicates by words
// alone. A cached model loads in a second or two; a download is not worth holding a save for.
const MODEL_WAIT_MS = 5000;

// Whether meaning took part in a search, and if not, why.
type MeaningSearch = "used" | "loading" | "unavailable";

// Scopes and kinds narrow the candidates of both rankings before any of them is cut to size.
type SearchQuery = RelatedQuery;

export interface SearchResult {
  // Best match first.
  readonly memories: Memory[];
  readonly meaning: MeaningSearch;
}

export interface Retriever {
  // Any shared word, ranked, plus meaning once the model is loaded. Loading and embedding are
  // slow, so only tools call this, never hooks.
  search(query: SearchQuery): Promise<SearchResult>;
  // The memories a new text duplicates: those repeating much of its words, plus those that mean the
  // same once the model is loaded. A model still loading is awaited for up to MODEL_WAIT_MS, as a
  // duplicate missed here is saved silently.
  duplicatesOf(query: SearchQuery): Promise<SearchResult>;
}

interface RetrieverDeps {
  readonly store: MemoryStore;
  readonly vectors: VectorIndex;
  readonly embedder: Pick<LazyEmbedder, "request" | "settled">;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: HostPort["log"];
}

// Vectors are unit length, so the dot product is the cosine. Vectors of different sizes come from
// different models and have no similarity.
function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new EmbeddingShapeError(`vectors of ${a.length} and ${b.length} numbers to compare`);
  }
  let sum = 0;
  for (const [index, value] of a.entries()) {
    sum += value * (b[index] ?? 0);
  }
  return sum;
}

async function embedQuery(embedder: Embedder, text: string): Promise<Float32Array> {
  const [query] = await embedder.embed([text]);
  if (query === undefined) {
    throw new EmbeddingShapeError("no vector for the query");
  }
  return query;
}

// The memories a search ranks by meaning or by word share: every one in scope and of the kinds asked.
function candidatesFor(store: MemoryStore, query: SearchQuery): Memory[] {
  return store
    .inScopes(query.scopes)
    .filter((memory) => query.kinds === undefined || query.kinds.includes(memory.kind));
}

// Words are those of `wordsOf`, the one definition the duplicate check uses.
function rankByWordShare(candidates: readonly Memory[], text: string): Memory[] {
  const wanted = wordsOf(text);
  return candidates
    .map((memory) => ({ memory, share: wordShare(wanted, titleAndBody(memory)) }))
    .filter((entry) => entry.share >= MIN_WORD_SHARE)
    .toSorted((a, b) => b.share - a.share)
    .slice(0, RANKING_DEPTH)
    .map((entry) => entry.memory);
}

async function rankByMeaning(
  deps: Pick<RetrieverDeps, "vectors">,
  embedder: Embedder,
  candidates: readonly Memory[],
  text: string,
): Promise<Memory[]> {
  if (candidates.length === 0) {
    return [];
  }
  const queryVector = await embedQuery(embedder, text);
  const vectors = await deps.vectors.vectorsFor(candidates, embedder, queryVector.length);
  const scored = candidates.flatMap((memory) => {
    const vector = vectors.get(memory.id);
    return vector === undefined ? [] : [{ memory, score: cosine(queryVector, vector) }];
  });
  return scored
    .filter((entry) => entry.score >= MIN_SIMILARITY)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, RANKING_DEPTH)
    .map((entry) => entry.memory);
}

async function modelState(deps: RetrieverDeps, waitForModel: boolean): Promise<EmbedderState> {
  const state = deps.embedder.request();
  if (!waitForModel || state.status !== "loading") {
    return state;
  }
  // The injected sleep's timer is unref'd, so when the load wins the race the pending timer never
  // holds the process open.
  await Promise.race([deps.embedder.settled(), deps.sleep(MODEL_WAIT_MS)]);
  return deps.embedder.request();
}

// `byWords` is the text ranking; meaning joins it once the model is ready.
async function withMeaning(
  deps: RetrieverDeps,
  query: SearchQuery,
  { byWords, waitForModel }: { byWords: Memory[]; waitForModel: boolean },
): Promise<SearchResult> {
  const state = await modelState(deps, waitForModel);
  if (state.status !== "ready") {
    return { memories: byWords.slice(0, query.limit), meaning: state.status };
  }
  try {
    const candidates = candidatesFor(deps.store, query);
    const byMeaning = await rankByMeaning(deps, state.embedder, candidates, query.text);
    const fused = fuseRankings([byWords, byMeaning], (memory) => memory.id);
    return { memories: fused.slice(0, query.limit), meaning: "used" };
  } catch (error) {
    deps.log("warn", "semantic search failed, using text matching only", {
      error: String(error),
    });
    return { memories: byWords.slice(0, query.limit), meaning: "unavailable" };
  }
}

export function createRetriever(deps: RetrieverDeps): Retriever {
  return {
    search: (query) =>
      withMeaning(deps, query, {
        byWords: deps.store.related({ ...query, limit: RANKING_DEPTH }),
        waitForModel: false,
      }),
    duplicatesOf: (query) =>
      withMeaning(deps, query, {
        byWords: rankByWordShare(candidatesFor(deps.store, query), query.text),
        waitForModel: true,
      }),
  };
}

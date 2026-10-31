import type { Memory } from "../../model/memory";
import type { HostPort } from "../../port";
import type { RelatedQuery } from "../../store/cache";
import { type Embedder, EmbeddingShapeError } from "../../store/embedder";
import type { MemoryStore } from "../../store/memory-store";
import type { VectorIndex } from "../../store/vector-index";
import type { EmbedderState, LazyEmbedder } from "./embeddings/lazy-embedder";
import { fuseRankings } from "./rank-fusion";

const RANKING_DEPTH = 20;

// Meaning matches below this are unrelated within one language; the live embedding-model test
// guards the value.
export const MIN_SIMILARITY = 0.91;

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

interface SearchOptions {
  // Wait up to MODEL_WAIT_MS for a model still loading, instead of answering by words at once.
  readonly waitForModel?: boolean;
}

export interface Retriever {
  // Text matching, plus meaning once the model is loaded. Loading and embedding are slow, so only
  // tools call this, never hooks.
  search(query: SearchQuery, options?: SearchOptions): Promise<SearchResult>;
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

async function rankByMeaning(
  deps: Pick<RetrieverDeps, "store" | "vectors">,
  embedder: Embedder,
  query: SearchQuery,
): Promise<Memory[]> {
  const candidates = deps.store
    .inScopes(query.scopes)
    .filter((memory) => query.kinds === undefined || query.kinds.includes(memory.kind));
  if (candidates.length === 0) {
    return [];
  }
  const queryVector = await embedQuery(embedder, query.text);
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

export function createRetriever(deps: RetrieverDeps): Retriever {
  return {
    async search(query, { waitForModel = false } = {}) {
      const byText = deps.store.related({ ...query, limit: RANKING_DEPTH });
      const state = await modelState(deps, waitForModel);
      if (state.status !== "ready") {
        return { memories: byText.slice(0, query.limit), meaning: state.status };
      }
      try {
        const byMeaning = await rankByMeaning(deps, state.embedder, query);
        const fused = fuseRankings([byText, byMeaning], (memory) => memory.id);
        return { memories: fused.slice(0, query.limit), meaning: "used" };
      } catch (error) {
        deps.log("warn", "semantic search failed, using text matching only", {
          error: String(error),
        });
        return { memories: byText.slice(0, query.limit), meaning: "unavailable" };
      }
    },
  };
}

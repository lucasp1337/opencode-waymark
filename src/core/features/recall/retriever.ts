import type { Memory } from "../../model/memory";
import type { HostPort } from "../../port";
import type { RelatedQuery } from "../../store/cache";
import { type Embedder, EmbeddingShapeError } from "../../store/embedder";
import type { MemoryStore } from "../../store/memory-store";
import type { VectorIndex } from "../../store/vector-index";
import type { LazyEmbedder } from "./embeddings/lazy-embedder";
import { fuseRankings } from "./rank-fusion";

const RANKING_DEPTH = 20;

// A meaning match must be close to count at all; otherwise every search, and every save's
// duplicate check, would return the nearest memory however unrelated. e5 puts paraphrases around
// 0.9 and unrelated text around 0.7–0.8; the value is not yet calibrated on this model.
const MIN_SIMILARITY = 0.85;

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
  // Text matching, plus meaning once the model is loaded. Loading and embedding are slow, so only
  // tools call this, never hooks.
  search(query: SearchQuery): Promise<SearchResult>;
}

interface RetrieverDeps {
  readonly store: MemoryStore;
  readonly vectors: VectorIndex;
  readonly embedder: Pick<LazyEmbedder, "request">;
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

export function createRetriever(deps: RetrieverDeps): Retriever {
  return {
    async search(query) {
      const byText = deps.store.related({ ...query, limit: RANKING_DEPTH });
      const state = deps.embedder.request();
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

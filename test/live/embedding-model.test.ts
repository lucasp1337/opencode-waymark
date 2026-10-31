import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadTransformersEmbedder } from "../../src/core/features/recall/embeddings/transformers-embedder";
import { MIN_SIMILARITY } from "../../src/core/features/recall/retriever";
import type { Embedder } from "../../src/core/store/embedder";
import { useTempDirs } from "../temp-dir";
import { LIVE_MODEL_CACHE } from "./harness";

// Memories are embedded as title and body; all three are Slovak developer notes, as one store in
// one language would hold.
const ORIGINAL =
  "Nasadzovací skript sa spúšťa z koreňa repozitára\nSpustenie z podadresára rozbije relatívne cesty.";
const PARAPHRASE =
  "Nasadzovací skript spúšťaj iba v hlavnom priečinku repozitára\nInde spustený skript má nefunkčné relatívne cesty.";
const UNRELATED =
  "Integračné testy potrebujú spustený Docker\nPred sadou testov štartujú kontajner s Postgresom.";

const tempDir = useTempDirs();
let embedder: Embedder | undefined;

// Vectors are unit length, so the dot product is the cosine.
function cosine(a: Float32Array, b: Float32Array): number {
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
}

async function similarity(a: string, b: string): Promise<number> {
  if (embedder === undefined) {
    throw new Error("the model did not load");
  }
  const [first] = await embedder.embed([a]);
  const [second] = await embedder.embed([b]);
  if (first === undefined || second === undefined) {
    throw new Error("the model returned fewer vectors than texts");
  }
  return cosine(first, second);
}

describe("embedding model", () => {
  // The first run downloads the model, so this needs network access and a generous timeout.
  beforeAll(async () => {
    embedder = await loadTransformersEmbedder(LIVE_MODEL_CACHE ?? tempDir());
  });

  afterAll(async () => {
    await embedder?.close?.();
  });

  test("a Slovak paraphrase of a Slovak memory scores at or above the similarity floor", async () => {
    expect(await similarity(ORIGINAL, PARAPHRASE)).toBeGreaterThanOrEqual(MIN_SIMILARITY);
  });

  test("an unrelated Slovak developer note scores below the similarity floor", async () => {
    expect(await similarity(ORIGINAL, UNRELATED)).toBeLessThan(MIN_SIMILARITY);
  });
});

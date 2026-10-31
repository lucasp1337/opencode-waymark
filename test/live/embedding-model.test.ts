import { describe, expect, test } from "bun:test";
import { loadTransformersEmbedder } from "../../src/core/features/recall/embeddings/transformers-embedder";
import { useTempDirs } from "../temp-dir";
import { LIVE_MODEL_CACHE } from "./harness";

const ENGLISH = "The deploy script must run from the repository root.";
const SLOVAK_PARAPHRASE = "Skript na nasadenie sa musí spúšťať z koreňového adresára repozitára.";
const UNRELATED = "Nightly database backups run at two in the morning.";

const tempDir = useTempDirs();

// Vectors are unit length, so the dot product is the cosine.
function cosine(a: Float32Array, b: Float32Array): number {
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
}

describe("embedding model", () => {
  // The first run downloads the model, so this needs network access and a generous timeout.
  test("a Slovak paraphrase is closer to its English original than an unrelated sentence is", async () => {
    const embedder = await loadTransformersEmbedder(LIVE_MODEL_CACHE ?? tempDir());
    const [english, slovak, unrelated] = await embedder.embed([
      ENGLISH,
      SLOVAK_PARAPHRASE,
      UNRELATED,
    ]);
    await embedder.close?.();
    if (english === undefined || slovak === undefined || unrelated === undefined) {
      throw new Error("the model returned fewer vectors than sentences");
    }

    const paraphrase = cosine(english, slovak);
    const other = cosine(english, unrelated);
    console.log(`paraphrase ${paraphrase.toFixed(3)}, unrelated ${other.toFixed(3)}`);

    expect(paraphrase).toBeGreaterThan(other);
  });
});

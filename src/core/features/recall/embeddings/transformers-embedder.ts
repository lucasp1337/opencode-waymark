import type { Tensor } from "@huggingface/transformers";
import type { Embedder } from "../../../store/embedder";

const MODEL = "Xenova/multilingual-e5-small";

// e5 models were trained with this prefix on both sides of a symmetric comparison, which is what
// matching a memory against a query of the same kind of text is.
const PREFIX = "query: ";

// Texts are padded to the longest of their batch, and attention memory grows with the square of
// that length, so a large store is embedded in several modest batches rather than one.
const BATCH_SIZE = 16;

// One row per text. A tensor of any other shape yields fewer rows, which the caller rejects.
function rows(tensor: Tensor): Float32Array[] {
  const [count = 0, size = 0] = tensor.dims;
  const flat = Float32Array.from(tensor.data, Number);
  return Array.from({ length: count }, (_, row) => flat.slice(row * size, (row + 1) * size));
}

// The only place that reaches the network: the first load downloads the model into `cacheDir`.
export async function loadTransformersEmbedder(cacheDir: string): Promise<Embedder> {
  const { pipeline } = await import("@huggingface/transformers");
  const extract = await pipeline("feature-extraction", MODEL, {
    dtype: "q8",
    cache_dir: cacheDir,
  });
  return {
    model: MODEL,
    async embed(texts) {
      const vectors: Float32Array[] = [];
      for (let start = 0; start < texts.length; start += BATCH_SIZE) {
        const batch = texts.slice(start, start + BATCH_SIZE).map((text) => `${PREFIX}${text}`);
        vectors.push(...rows(await extract(batch, { pooling: "mean", normalize: true })));
      }
      return vectors;
    },
    close: () => extract.dispose(),
  };
}

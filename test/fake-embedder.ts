import type { Embedder } from "../src/core/store/embedder";

// Phrases that mean the same thing, in any language. They share one axis, so a sentence and its
// translation point the same way and unrelated sentences are orthogonal.
export type Concept = readonly string[];

export interface FakeEmbedder extends Embedder {
  // The texts of each embed call, in call order.
  readonly calls: string[][];
}

export function fakeEmbedder(concepts: readonly Concept[], model = "fake-model"): FakeEmbedder {
  const calls: string[][] = [];
  const vectorOf = (text: string): Float32Array => {
    const axes = concepts.map((concept) =>
      concept.some((phrase) => text.includes(phrase)) ? 1 : 0,
    );
    const length = Math.hypot(...axes);
    return Float32Array.from(axes, (axis) => (length === 0 ? 0 : axis / length));
  };
  return {
    model,
    calls,
    embed(texts) {
      calls.push([...texts]);
      return Promise.resolve(texts.map(vectorOf));
    },
  };
}

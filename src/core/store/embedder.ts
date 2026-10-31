// Turns texts into unit vectors, one per text and in the same order. The real one runs a local
// model; tests use a fake.
export interface Embedder {
  readonly model: string;
  embed(texts: readonly string[]): Promise<Float32Array[]>;
}

// The embedder broke its contract: the wrong number of vectors, or vectors of the wrong size.
export class EmbeddingShapeError extends Error {
  constructor(detail: string) {
    super(`embedder returned ${detail}`);
    this.name = "EmbeddingShapeError";
  }
}

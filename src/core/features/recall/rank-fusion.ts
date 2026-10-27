// Reciprocal rank fusion: only rank positions count, so rankings with incomparable scores (bm25,
// cosine) combine without calibration. 60 is the constant from the original RRF paper.
const RRF_K = 60;

interface Scored<T> {
  readonly item: T;
  score: number;
}

// Items are identified by `key`. Ties keep first-seen order: earlier rankings, then earlier ranks.
export function fuseRankings<T>(
  rankings: readonly (readonly T[])[],
  key: (item: T) => string,
): T[] {
  const scored = new Map<string, Scored<T>>();
  for (const ranking of rankings) {
    for (const [index, item] of ranking.entries()) {
      const id = key(item);
      const entry = scored.get(id) ?? { item, score: 0 };
      entry.score += 1 / (RRF_K + index + 1);
      scored.set(id, entry);
    }
  }
  return [...scored.values()].sort((a, b) => b.score - a.score).map((entry) => entry.item);
}

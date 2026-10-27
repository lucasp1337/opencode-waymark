import { isIndexed } from "../../model/kind";
import { activeOnly } from "../../model/memory";
import type { ScopeChain } from "../../model/scope";
import type { MemoryStore } from "../../store/memory-store";
import type { Telemetry } from "../../telemetry/telemetry";
import type { ReviewSignals } from "../commands/review-report";
import { hasLeftIndex } from "./index-exit";
import type { IndexExitThresholds, NoisyThresholds } from "./lifecycle-settings";
import { isNoisy } from "./noisy-gotcha";

interface ReviewSignalDeps {
  readonly store: Pick<MemoryStore, "inScopes">;
  readonly counters: Pick<Telemetry, "stats" | "firesWithin">;
  readonly now: () => Date;
  // Read per review, so a changed setting applies without a restart.
  readonly indexExit: () => IndexExitThresholds;
  readonly noisy: NoisyThresholds;
}

// What the telemetry noticed in a chain, by the same rules the session index and the gotcha check
// use.
export function createReviewSignals(deps: ReviewSignalDeps): (chain: ScopeChain) => ReviewSignals {
  return (chain) => {
    const memories = activeOnly(deps.store.inScopes(chain));
    const indexed = memories.filter((memory) => isIndexed(memory.kind));
    const usage = {
      stats: deps.counters.stats(indexed.map((memory) => memory.id)),
      now: deps.now(),
      exit: deps.indexExit(),
    };
    return {
      leftIndex: indexed.filter((memory) => hasLeftIndex(memory, usage)).map((memory) => memory.id),
      noisy: memories
        .filter((memory) =>
          isNoisy(memory, deps.counters.firesWithin(memory.id, deps.noisy.days), deps.noisy),
        )
        .map((memory) => memory.id),
    };
  };
}

import type { HostPort } from "../../../port";
import type { Embedder } from "../../../store/embedder";

export type EmbedderState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly embedder: Embedder }
  | { readonly status: "unavailable"; readonly reason: string };

export interface LazyEmbedder {
  // Starts loading on the first call, then answers at once with whatever the load has reached.
  request(): EmbedderState;
  // Frees the model. A load that finishes after this frees itself. Idempotent.
  close(): void;
}

const LOADING: EmbedderState = { status: "loading" };
const CLOSED: EmbedderState = { status: "unavailable", reason: "closed" };

// The logger is the last place a failure can be reported to, so one that throws is dropped rather
// than becoming an unhandled rejection in a background task.
function warn(log: HostPort["log"], msg: string, data: object): void {
  try {
    log("warn", msg, data);
  } catch {
    return;
  }
}

// The model is only fetched once somebody searches. A failed load is not retried until the next
// activation, so an offline machine does not retry a download on every search.
export function createLazyEmbedder(
  load: () => Promise<Embedder>,
  log: HostPort["log"],
): LazyEmbedder {
  let state: EmbedderState | undefined;

  async function release(embedder: Embedder): Promise<void> {
    try {
      await embedder.close?.();
    } catch (error) {
      warn(log, "embedding model did not close cleanly", { error: String(error) });
    }
  }

  function loaded(embedder: Embedder): void {
    if (state === CLOSED) {
      void release(embedder);
    } else {
      state = { status: "ready", embedder };
    }
  }

  function failed(error: unknown): void {
    if (state !== CLOSED) {
      const reason = String(error);
      state = { status: "unavailable", reason };
      warn(log, "embedding model unavailable, search uses text matching only", {
        reason,
      });
    }
  }

  return {
    request() {
      if (state === undefined) {
        state = LOADING;
        // Through then, so a load that throws before returning a promise also counts as failed.
        Promise.resolve().then(load).then(loaded, failed);
      }
      return state;
    },
    close() {
      const previous = state;
      state = CLOSED;
      if (previous?.status === "ready") {
        void release(previous.embedder);
      }
    },
  };
}

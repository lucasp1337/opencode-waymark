import type { MemoryId } from "../model/id";
import type { HostPort } from "../port";
import type { MemoryStats, Telemetry } from "./telemetry";

// The counters only inform. A failing one is logged and answers as if nothing had been recorded,
// so it can neither fail a memory_read or session start nor lose a gotcha that was about to be
// delivered.
export function lenientTelemetry(inner: Telemetry, log: HostPort["log"]): Telemetry {
  function attempt<T>(operation: string, fallback: T, run: () => T): T {
    try {
      return run();
    } catch (error) {
      log("warn", "telemetry failed", { operation, error: String(error) });
      return fallback;
    }
  }
  return {
    recordRead: (id) => attempt("recordRead", undefined, () => inner.recordRead(id)),
    recordSessions: (ids) => attempt("recordSessions", undefined, () => inner.recordSessions(ids)),
    recordFire: (id) => attempt("recordFire", undefined, () => inner.recordFire(id)),
    firesWithin: (id, days) => attempt("firesWithin", 0, () => inner.firesWithin(id, days)),
    stats: (ids) => attempt("stats", new Map<MemoryId, MemoryStats>(), () => inner.stats(ids)),
    close: () => inner.close(),
  };
}

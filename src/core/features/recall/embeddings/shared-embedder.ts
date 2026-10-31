import type { Embedder } from "../../../store/embedder";

// Where the one load of a model for this process is kept.
export interface EmbedderSlot {
  get(): Promise<Embedder> | undefined;
  set(load: Promise<Embedder>): void;
  clear(): void;
}

// A model costs hundreds of MB that disposing does not hand back, and a host may run several
// activations in one process, each with its own copy of this module. The process global is the only
// place they all see, so the model is loaded once there and never disposed.
export function processEmbedderSlot(model: string): EmbedderSlot {
  const key = Symbol.for(`waymark.embedder:${model}`);
  return {
    get() {
      const held: unknown = Reflect.get(globalThis, key);
      // Only this module writes the key, and always a load promise, so the Promise check is enough.
      return held instanceof Promise ? held : undefined;
    },
    set: (load) => Reflect.set(globalThis, key, load),
    clear: () => Reflect.deleteProperty(globalThis, key),
  };
}

// Callers share the load in flight or finished. A failed load is forgotten so the next caller
// retries; callers already holding the failure keep it.
export function shareEmbedderLoad(
  load: () => Promise<Embedder>,
  slot: EmbedderSlot,
): () => Promise<Embedder> {
  return () => {
    const held = slot.get();
    if (held !== undefined) {
      return held;
    }
    // Through then, so a load that throws before returning a promise also counts as failed.
    const pending = Promise.resolve().then(load);
    slot.set(pending);
    pending.catch(() => {
      if (slot.get() === pending) {
        slot.clear();
      }
    });
    return pending;
  };
}

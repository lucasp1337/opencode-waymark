import { afterEach, describe, expect, test } from "bun:test";
import type { Embedder } from "../../../store/embedder";
import { createLazyEmbedder } from "./lazy-embedder";
import { type EmbedderSlot, processEmbedderSlot, shareEmbedderLoad } from "./shared-embedder";

const embedder: Embedder = { model: "fake", embed: () => Promise.resolve([]) };

function memorySlot(): EmbedderSlot {
  let held: Promise<Embedder> | undefined;
  return {
    get: () => held,
    set: (load) => {
      held = load;
    },
    clear: () => {
      held = undefined;
    },
  };
}

// Each call consumes the next outcome; once they run out the load succeeds.
function countingLoad(outcomes: Array<Embedder | Error>) {
  const calls = { count: 0 };
  const load = () => {
    const outcome = outcomes[calls.count] ?? embedder;
    calls.count += 1;
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  };
  return { calls, load };
}

describe("shareEmbedderLoad", () => {
  test("two activations get the same embedder from one load", async () => {
    const slot = memorySlot();
    const { calls, load } = countingLoad([embedder]);
    const first = shareEmbedderLoad(load, slot);
    const second = shareEmbedderLoad(load, slot);

    expect(await first()).toBe(await second());
    expect(calls.count).toBe(1);
  });

  test("callers that ask while the first load is in flight share it", async () => {
    const { calls, load } = countingLoad([embedder]);
    const shared = shareEmbedderLoad(load, memorySlot());

    await Promise.all([shared(), shared(), shared()]);

    expect(calls.count).toBe(1);
  });

  test("a later caller retries after a failed load", async () => {
    const { calls, load } = countingLoad([new Error("offline")]);
    const shared = shareEmbedderLoad(load, memorySlot());

    await expect(shared()).rejects.toThrow("offline");
    await Promise.resolve();

    expect(await shared()).toBe(embedder);
    expect(calls.count).toBe(2);
  });

  test("a late failure does not evict a newer load, and earlier callers still see it", async () => {
    const slot = memorySlot();
    const stale = Promise.withResolvers<Embedder>();
    const first = shareEmbedderLoad(() => stale.promise, slot)();
    slot.clear();
    const second = shareEmbedderLoad(() => Promise.resolve(embedder), slot)();

    stale.reject(new Error("offline"));

    await expect(first).rejects.toThrow("offline");
    await Promise.resolve();
    expect(slot.get()).toBe(second);
  });

  test("a load that throws before returning a promise is a failed load", async () => {
    const shared = shareEmbedderLoad(() => {
      throw new Error("no runtime");
    }, memorySlot());

    await expect(shared()).rejects.toThrow("no runtime");
  });

  test("closing one activation leaves the other's embedder working", async () => {
    const shared = shareEmbedderLoad(countingLoad([embedder]).load, memorySlot());
    const closing = createLazyEmbedder(shared, () => undefined);
    const staying = createLazyEmbedder(shared, () => undefined);
    closing.start();
    staying.start();
    await closing.settled();
    await staying.settled();

    closing.close();

    expect(staying.request()).toEqual({ status: "ready", embedder });
  });
});

describe("processEmbedderSlot", () => {
  const models = ["waymark-test-model-a", "waymark-test-model-b"] as const;

  afterEach(() => {
    for (const model of models) {
      processEmbedderSlot(model).clear();
    }
  });

  test("separate slot objects for the same model see one load", () => {
    const pending = Promise.resolve(embedder);

    processEmbedderSlot("waymark-test-model-a").set(pending);

    expect(processEmbedderSlot("waymark-test-model-a").get()).toBe(pending);
  });

  test("a cleared slot is empty", () => {
    const slot = processEmbedderSlot("waymark-test-model-a");
    slot.set(Promise.resolve(embedder));

    slot.clear();

    expect(slot.get()).toBeUndefined();
  });

  test("different models do not share a slot", () => {
    processEmbedderSlot("waymark-test-model-a").set(Promise.resolve(embedder));

    expect(processEmbedderSlot("waymark-test-model-b").get()).toBeUndefined();
  });
});

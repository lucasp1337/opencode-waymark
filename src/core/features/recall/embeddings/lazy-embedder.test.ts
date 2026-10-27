import { describe, expect, test } from "bun:test";
import type { LogLevel } from "../../../port";
import type { Embedder } from "../../../store/embedder";
import { createLazyEmbedder } from "./lazy-embedder";

interface Closing extends Embedder {
  readonly closed: { count: number };
}

function closableEmbedder(close?: () => Promise<void> | void): Closing {
  const closed = { count: 0 };
  return {
    model: "fake",
    embed: () => Promise.resolve([]),
    closed,
    close() {
      closed.count += 1;
      return close?.();
    },
  };
}

const embedder: Embedder = { model: "fake", embed: () => Promise.resolve([]) };

// Lets every promise reaction queued so far run, without waiting for any time to pass.
function settled(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// Counts load attempts; the test settles the load through `load`.
function pendingLoad() {
  const load = Promise.withResolvers<Embedder>();
  const started = { count: 0 };
  const logs: Array<{ level: LogLevel; msg: string; data?: unknown }> = [];
  const lazy = createLazyEmbedder(
    () => {
      started.count += 1;
      return load.promise;
    },
    (level, msg, data) => logs.push({ level, msg, data }),
  );
  return { load, started, logs, lazy };
}

async function failedLoad() {
  const pending = pendingLoad();
  pending.lazy.request();
  pending.load.reject(new Error("offline"));
  await settled();
  return pending;
}

describe("createLazyEmbedder", () => {
  test("does not load until the first request", () => {
    const { started } = pendingLoad();

    expect(started.count).toBe(0);
  });

  test("the first request starts the load and reports loading", async () => {
    const { lazy, started } = pendingLoad();

    expect(lazy.request()).toEqual({ status: "loading" });
    await settled();
    expect(started.count).toBe(1);
  });

  test("keeps reporting loading until the load finishes, without loading again", async () => {
    const { lazy, started } = pendingLoad();

    lazy.request();

    expect(lazy.request()).toEqual({ status: "loading" });
    await settled();
    expect(started.count).toBe(1);
  });

  test("reports the embedder once the load succeeds", async () => {
    const { lazy, load } = pendingLoad();
    lazy.request();

    load.resolve(embedder);
    await settled();

    expect(lazy.request()).toEqual({ status: "ready", embedder });
  });

  test("reports unavailable with the reason once the load fails", async () => {
    const { lazy } = await failedLoad();

    expect(lazy.request()).toEqual({ status: "unavailable", reason: "Error: offline" });
  });

  test("a load that throws before returning a promise counts as failed", async () => {
    const lazy = createLazyEmbedder(
      () => {
        throw new Error("no runtime");
      },
      () => undefined,
    );

    expect(lazy.request()).toEqual({ status: "loading" });
    await settled();

    expect(lazy.request()).toEqual({ status: "unavailable", reason: "Error: no runtime" });
  });

  test("logs a failed load once however often it is asked afterwards", async () => {
    const { lazy, logs } = await failedLoad();

    lazy.request();
    lazy.request();

    expect(logs.map((entry) => [entry.level, entry.data])).toEqual([
      ["warn", { reason: "Error: offline" }],
    ]);
  });

  test("does not try again after a failed load", async () => {
    const { lazy, started } = await failedLoad();

    lazy.request();
    await settled();

    expect(started.count).toBe(1);
  });

  test("a logger that throws still leaves the load reported as failed", async () => {
    const load = Promise.withResolvers<Embedder>();
    const lazy = createLazyEmbedder(
      () => load.promise,
      () => {
        throw new Error("disk full");
      },
    );
    lazy.request();

    load.reject(new Error("offline"));
    await settled();

    expect(lazy.request()).toEqual({ status: "unavailable", reason: "Error: offline" });
  });

  test("two lazy embedders keep their own state", async () => {
    const first = pendingLoad();
    const second = pendingLoad();
    first.lazy.request();
    second.lazy.request();

    first.load.resolve(embedder);
    await settled();

    expect(second.lazy.request()).toEqual({ status: "loading" });
  });
});

describe("closing a lazy embedder", () => {
  test("closes a loaded embedder and reports unavailable from then on", async () => {
    const { lazy, load } = pendingLoad();
    const model = closableEmbedder();
    lazy.request();
    load.resolve(model);
    await settled();

    lazy.close();

    expect(model.closed.count).toBe(1);
    expect(lazy.request()).toEqual({ status: "unavailable", reason: "closed" });
  });

  test("closing twice closes the embedder once", async () => {
    const { lazy, load } = pendingLoad();
    const model = closableEmbedder();
    lazy.request();
    load.resolve(model);
    await settled();

    lazy.close();
    lazy.close();

    expect(model.closed.count).toBe(1);
  });

  test("an embedder that finishes loading after the close closes itself", async () => {
    const { lazy, load } = pendingLoad();
    const model = closableEmbedder();
    lazy.request();

    lazy.close();
    load.resolve(model);
    await settled();

    expect(model.closed.count).toBe(1);
    expect(lazy.request()).toEqual({ status: "unavailable", reason: "closed" });
  });

  test("a load that fails after the close is not reported", async () => {
    const { lazy, load, logs } = pendingLoad();
    lazy.request();

    lazy.close();
    load.reject(new Error("offline"));
    await settled();

    expect(logs).toEqual([]);
  });

  test("never loads when it is closed before the first request", async () => {
    const { lazy, started } = pendingLoad();

    lazy.close();

    expect(lazy.request()).toEqual({ status: "unavailable", reason: "closed" });
    await settled();
    expect(started.count).toBe(0);
  });

  test("closes an embedder that has nothing to free", async () => {
    const { lazy, load } = pendingLoad();
    lazy.request();
    load.resolve(embedder);
    await settled();

    expect(() => lazy.close()).not.toThrow();
  });

  test("logs an embedder that fails to close, and still reports closed", async () => {
    const { lazy, load, logs } = pendingLoad();
    lazy.request();
    load.resolve(
      closableEmbedder(() => {
        throw new Error("busy");
      }),
    );
    await settled();

    lazy.close();
    await settled();

    expect(logs.map((entry) => entry.data)).toEqual([{ error: "Error: busy" }]);
    expect(lazy.request()).toEqual({ status: "unavailable", reason: "closed" });
  });
});

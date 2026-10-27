import { afterEach } from "bun:test";
import { join } from "node:path";
import type {
  EmbedderState,
  LazyEmbedder,
} from "../src/core/features/recall/embeddings/lazy-embedder";
import { createRetriever, type Retriever } from "../src/core/features/recall/retriever";
import { type Memory, newMemory } from "../src/core/model/memory";
import type { ScopeRef } from "../src/core/model/scope";
import { nodeFileSystem } from "../src/core/store/fs";
import { type MemoryStore, openMemoryStore } from "../src/core/store/memory-store";
import { openVectorIndex, type VectorIndex } from "../src/core/store/vector-index";
import { createFakeHost, type FakeHost } from "./fake-host";
import { memoryId } from "./memory-id";
import { useTempDirs } from "./temp-dir";
import { validContent } from "./valid-content";

export interface SearchFixture {
  readonly host: FakeHost;
  readonly store: MemoryStore;
  readonly retriever: Retriever;
}

// A lazy embedder that is stuck in one state, so a test decides what the model is doing.
export function embedderIn(state: EmbedderState): Pick<LazyEmbedder, "request"> {
  return { request: () => state };
}

// Retrievers over a real store and vector index in a temp dir, closed and deleted after each test.
export function useSearchFixture(): (embedder: Pick<LazyEmbedder, "request">) => SearchFixture {
  const tempRoot = useTempDirs();
  const opened: Array<MemoryStore | VectorIndex> = [];
  afterEach(() => {
    for (const resource of opened.splice(0)) {
      resource.close();
    }
  });
  return (embedder) => {
    const root = tempRoot();
    const { store } = openMemoryStore(root, nodeFileSystem);
    const { index: vectors } = openVectorIndex(join(root, "vectors.sqlite"));
    opened.push(store, vectors);
    const host = createFakeHost();
    const retriever = createRetriever({ store, vectors, embedder, log: host.log });
    return { host, store, retriever };
  };
}

interface MemorySpec {
  readonly title: string;
  readonly body: string;
  readonly kind?: "fact" | "preference";
  readonly scope?: ScopeRef;
}

// Builds the memory whose id ends in <n> without saving it; the caller picks the store.
export function searchMemory(n: number, spec: MemorySpec): Memory {
  const { title, body, kind = "fact", scope = { level: "user" } } = spec;
  return newMemory(validContent({ kind, title, body }), {
    id: memoryId(`01JB8Z6Q4R3M2N1P0V9W8X${String(n).padStart(4, "0")}`),
    scope,
    now: new Date("2026-03-01T10:00:00.000Z"),
  });
}

import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { MemoryId } from "../model/id";
import type { Memory } from "../model/memory";
import { ownField } from "../model/own-field";
import { type DerivedSchema, openDerivedDatabase, writing } from "./derived-database";
import { type Embedder, EmbeddingShapeError } from "./embedder";

const SCHEMA: DerivedSchema = {
  version: 1,
  tables: ["vectors"],
  sql: `
    CREATE TABLE IF NOT EXISTS vectors (
      id TEXT PRIMARY KEY,
      digest TEXT NOT NULL,
      vector BLOB NOT NULL
    );
  `,
};

const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;

// A derived, deletable cache of memory embeddings; the memory files stay the source of truth.
export interface VectorIndex {
  // A vector of `dimensions` numbers for every memory. Those without a current one, or with one
  // of another size, are embedded together in one batch and kept, so a memory is embedded again
  // only after its text, the model or the vector size changes.
  vectorsFor(
    memories: readonly Memory[],
    embedder: Embedder,
    dimensions: number,
  ): Promise<Map<MemoryId, Float32Array>>;
  close(): void;
}

interface Wanted {
  readonly memory: Memory;
  readonly text: string;
  readonly digest: string;
}

function wantedFor(memory: Memory, model: string): Wanted {
  const text = `${memory.title}\n${memory.body}`;
  const digest = createHash("sha256").update(`${model}\n${text}`).digest("hex");
  return { memory, text, digest };
}

// Rows are read as unknown and narrowed here. A row that cannot be a current vector counts as
// missing, so it is embedded again and overwritten.
function currentVector(row: unknown, digest: string, dimensions: number): Float32Array | undefined {
  const bytes = ownField(row, "vector");
  if (ownField(row, "digest") !== digest || !(bytes instanceof Uint8Array)) {
    return undefined;
  }
  if (bytes.byteLength !== dimensions * FLOAT_BYTES) {
    return undefined;
  }
  return new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}

function storedVector(db: Database, wanted: Wanted, dimensions: number): Float32Array | undefined {
  const row = db
    .query<unknown, [string]>("SELECT digest, vector FROM vectors WHERE id = ?")
    .get(wanted.memory.id);
  return currentVector(row, wanted.digest, dimensions);
}

function storeVectors(db: Database, fresh: ReadonlyMap<Wanted, Float32Array>): void {
  const insert = db.query("INSERT OR REPLACE INTO vectors (id, digest, vector) VALUES (?, ?, ?)");
  writing(db, () => {
    for (const [wanted, vector] of fresh) {
      const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
      insert.run(wanted.memory.id, wanted.digest, bytes);
    }
  });
}

async function embedMissing(
  embedder: Embedder,
  missing: readonly Wanted[],
  dimensions: number,
): Promise<Map<Wanted, Float32Array>> {
  const vectors = await embedder.embed(missing.map((wanted) => wanted.text));
  const fresh = new Map<Wanted, Float32Array>();
  for (const [index, wanted] of missing.entries()) {
    const vector = vectors[index];
    if (vector === undefined) {
      throw new EmbeddingShapeError(`${vectors.length} vectors for ${missing.length} texts`);
    }
    if (vector.length !== dimensions) {
      throw new EmbeddingShapeError(`a vector of ${vector.length} numbers, not ${dimensions}`);
    }
    fresh.set(wanted, vector);
  }
  return fresh;
}

interface VectorRequest {
  readonly memories: readonly Memory[];
  readonly embedder: Embedder;
  readonly dimensions: number;
}

async function readOrEmbed(
  db: Database,
  { memories, embedder, dimensions }: VectorRequest,
): Promise<Map<MemoryId, Float32Array>> {
  const found = new Map<MemoryId, Float32Array>();
  const missing: Wanted[] = [];
  for (const wanted of memories.map((memory) => wantedFor(memory, embedder.model))) {
    const stored = storedVector(db, wanted, dimensions);
    if (stored === undefined) {
      missing.push(wanted);
    } else {
      found.set(wanted.memory.id, stored);
    }
  }
  if (missing.length > 0) {
    const fresh = await embedMissing(embedder, missing, dimensions);
    storeVectors(db, fresh);
    for (const [wanted, vector] of fresh) {
      found.set(wanted.memory.id, vector);
    }
  }
  return found;
}

// `reset` is why the file had to be recreated, for the caller to log; undefined when it opened
// normally.
export function openVectorIndex(file: string): {
  index: VectorIndex;
  reset: string | undefined;
} {
  const { db, reset } = openDerivedDatabase(file, SCHEMA);
  let closed = false;
  const index: VectorIndex = {
    vectorsFor: (memories, embedder, dimensions) =>
      readOrEmbed(db, { memories, embedder, dimensions }),
    close() {
      if (!closed) {
        closed = true;
        db.close();
      }
    },
  };
  return { index, reset };
}

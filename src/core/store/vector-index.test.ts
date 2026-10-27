import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeEmbedder } from "../../../test/fake-embedder";
import { searchMemory } from "../../../test/search-fixture";
import { useTempDirs } from "../../../test/temp-dir";
import { type Embedder, EmbeddingShapeError } from "./embedder";
import { openVectorIndex, type VectorIndex } from "./vector-index";

const CONCEPTS = [["deploy"], ["backup"]];
const DIMENSIONS = CONCEPTS.length;

const deploy = searchMemory(1, { title: "Deploy from root", body: "Run deploy.sh at the root." });
const backup = searchMemory(2, { title: "Backups", body: "Nightly backup at 02:00." });

const tempRoot = useTempDirs();
const opened: VectorIndex[] = [];

afterEach(() => {
  for (const index of opened.splice(0)) {
    index.close();
  }
});

function openIndex(file: string) {
  const result = openVectorIndex(file);
  opened.push(result.index);
  return result;
}

function freshIndex(): { index: VectorIndex; file: string } {
  const file = join(tempRoot(), "vectors.sqlite");
  return { index: openIndex(file).index, file };
}

function withDatabase(file: string, run: (db: Database) => void): void {
  const db = new Database(file);
  try {
    run(db);
  } finally {
    db.close();
  }
}

function damageVectors(file: string, assignment: string): void {
  withDatabase(file, (db) => db.exec(`UPDATE vectors SET vector = ${assignment}`));
}

describe("openVectorIndex", () => {
  test("embeds every memory in one batch and returns its vector", async () => {
    const { index } = freshIndex();
    const embedder = fakeEmbedder(CONCEPTS);

    const vectors = await index.vectorsFor([deploy, backup], embedder, DIMENSIONS);

    expect(embedder.calls).toEqual([
      ["Deploy from root\nRun deploy.sh at the root.", "Backups\nNightly backup at 02:00."],
    ]);
    expect(vectors.get(deploy.id)).toEqual(Float32Array.of(1, 0));
    expect(vectors.get(backup.id)).toEqual(Float32Array.of(0, 1));
  });

  test("reuses stored vectors instead of embedding again", async () => {
    const { index } = freshIndex();
    const embedder = fakeEmbedder(CONCEPTS);
    await index.vectorsFor([deploy, backup], embedder, DIMENSIONS);

    const vectors = await index.vectorsFor([deploy, backup], embedder, DIMENSIONS);

    expect(embedder.calls).toHaveLength(1);
    expect(vectors.get(backup.id)).toEqual(Float32Array.of(0, 1));
  });

  test("embeds only the memories that are new", async () => {
    const { index } = freshIndex();
    const embedder = fakeEmbedder(CONCEPTS);
    await index.vectorsFor([deploy], embedder, DIMENSIONS);

    await index.vectorsFor([deploy, backup], embedder, DIMENSIONS);

    expect(embedder.calls.at(-1)).toEqual(["Backups\nNightly backup at 02:00."]);
  });

  test("embeds a memory again after its body changes", async () => {
    const { index } = freshIndex();
    const embedder = fakeEmbedder(CONCEPTS);
    await index.vectorsFor([deploy], embedder, DIMENSIONS);

    const edited = { ...deploy, body: "Nightly backup first." };
    const vectors = await index.vectorsFor([edited], embedder, DIMENSIONS);

    expect(embedder.calls).toHaveLength(2);
    expect(vectors.get(deploy.id)).toEqual(Float32Array.of(0, 1));
  });

  test("embeds a memory again after its title changes", async () => {
    const { index } = freshIndex();
    const embedder = fakeEmbedder(CONCEPTS);
    await index.vectorsFor([deploy], embedder, DIMENSIONS);

    await index.vectorsFor([{ ...deploy, title: "Deploy anywhere" }], embedder, DIMENSIONS);

    expect(embedder.calls).toHaveLength(2);
  });

  test("embeds a memory again when another model is used", async () => {
    const { index } = freshIndex();
    await index.vectorsFor([deploy], fakeEmbedder(CONCEPTS, "model-a"), DIMENSIONS);
    const other = fakeEmbedder(CONCEPTS, "model-b");

    await index.vectorsFor([deploy], other, DIMENSIONS);

    expect(other.calls).toHaveLength(1);
  });

  test("a stored vector of another size than asked for is embedded again", async () => {
    const { index } = freshIndex();
    await index.vectorsFor([deploy], fakeEmbedder(CONCEPTS), DIMENSIONS);
    const wider = fakeEmbedder([...CONCEPTS, ["root"]]);

    const vectors = await index.vectorsFor([deploy], wider, DIMENSIONS + 1);

    expect(wider.calls).toHaveLength(1);
    expect(vectors.get(deploy.id)).toHaveLength(DIMENSIONS + 1);
  });

  test("keeps vectors across reopening the file", async () => {
    const { index, file } = freshIndex();
    await index.vectorsFor([deploy], fakeEmbedder(CONCEPTS), DIMENSIONS);
    index.close();
    const embedder = fakeEmbedder(CONCEPTS);

    const vectors = await openIndex(file).index.vectorsFor([deploy], embedder, DIMENSIONS);

    expect(embedder.calls).toEqual([]);
    expect(vectors.get(deploy.id)).toEqual(Float32Array.of(1, 0));
  });

  test("does not call the embedder when there are no memories", async () => {
    const { index } = freshIndex();
    const embedder = fakeEmbedder(CONCEPTS);

    const vectors = await index.vectorsFor([], embedder, DIMENSIONS);

    expect(vectors.size).toBe(0);
    expect(embedder.calls).toEqual([]);
  });

  test("a stored vector that is not a whole number of floats is embedded again", async () => {
    const { index, file } = freshIndex();
    await index.vectorsFor([deploy], fakeEmbedder(CONCEPTS), DIMENSIONS);
    damageVectors(file, "x'010203'");
    const embedder = fakeEmbedder(CONCEPTS);

    const vectors = await index.vectorsFor([deploy], embedder, DIMENSIONS);

    expect(embedder.calls).toHaveLength(1);
    expect(vectors.get(deploy.id)).toEqual(Float32Array.of(1, 0));
  });

  test("a stored vector that is not binary is embedded again", async () => {
    const { index, file } = freshIndex();
    await index.vectorsFor([deploy], fakeEmbedder(CONCEPTS), DIMENSIONS);
    damageVectors(file, "'text'");
    const embedder = fakeEmbedder(CONCEPTS);

    await index.vectorsFor([deploy], embedder, DIMENSIONS);

    expect(embedder.calls).toHaveLength(1);
  });

  test("an embedder that returns too few vectors is an error and stores nothing", async () => {
    const { index } = freshIndex();
    const short: Embedder = { model: "short", embed: () => Promise.resolve([]) };

    await expect(index.vectorsFor([deploy], short, DIMENSIONS)).rejects.toBeInstanceOf(
      EmbeddingShapeError,
    );

    const embedder = fakeEmbedder(CONCEPTS, "short");
    await index.vectorsFor([deploy], embedder, DIMENSIONS);
    expect(embedder.calls).toHaveLength(1);
  });

  test("an embedder that returns vectors of the wrong size is an error and stores nothing", async () => {
    const { index } = freshIndex();
    const narrow = fakeEmbedder([["deploy"]], "narrow");

    await expect(index.vectorsFor([deploy], narrow, DIMENSIONS)).rejects.toThrow(
      "a vector of 1 numbers, not 2",
    );

    const embedder = fakeEmbedder(CONCEPTS, "narrow");
    await index.vectorsFor([deploy], embedder, DIMENSIONS);
    expect(embedder.calls).toHaveLength(1);
  });

  test("a file that is not a database is replaced by an empty index and the reason reported", async () => {
    const file = join(tempRoot(), "vectors.sqlite");
    writeFileSync(file, "this is not a database, just text that is long enough to be read");
    const embedder = fakeEmbedder(CONCEPTS);

    const { index, reset } = openIndex(file);
    const vectors = await index.vectorsFor([deploy], embedder, DIMENSIONS);

    expect(reset).toContain("file is not a database");
    expect(vectors.get(deploy.id)).toEqual(Float32Array.of(1, 0));
  });

  test("a file from before the schema was versioned is replaced without being reported", async () => {
    const file = join(tempRoot(), "vectors.sqlite");
    withDatabase(file, (db) =>
      db.exec(
        "CREATE TABLE vectors (id TEXT PRIMARY KEY, model TEXT NOT NULL, digest TEXT NOT NULL, vector BLOB NOT NULL)",
      ),
    );
    const embedder = fakeEmbedder(CONCEPTS);

    const { index, reset } = openIndex(file);
    await index.vectorsFor([deploy], embedder, DIMENSIONS);

    expect(reset).toBeUndefined();
    expect(embedder.calls).toHaveLength(1);
  });

  test("a file that cannot be created is an error rather than a reset", () => {
    expect(() => openVectorIndex(join(tempRoot(), "missing", "vectors.sqlite"))).toThrow();
  });

  test("closing twice is harmless", () => {
    const { index } = freshIndex();

    index.close();

    expect(() => index.close()).not.toThrow();
  });
});

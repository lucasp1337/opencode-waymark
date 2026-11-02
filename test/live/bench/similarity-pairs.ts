// Prints cosine and word-share statistics for English developer-note pairs, to tune MIN_SIMILARITY
// and MIN_WORD_SHARE. Same-topic and unrelated notes should not be flagged as duplicates;
// paraphrases and near-verbatim copies should be.
// Usage: bun test/live/bench/similarity-pairs.ts   (WAYMARK_LIVE_MODEL_CACHE reuses a downloaded model)
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EMBEDDING_MODEL,
  loadTransformersEmbedder,
} from "../../../src/core/features/recall/embeddings/transformers-embedder";
import { MIN_SIMILARITY, MIN_WORD_SHARE } from "../../../src/core/features/recall/retriever";
import { wordShare } from "../../../src/core/features/recall/word-share";
import { titleAndBody } from "../../../src/core/model/memory";
import { wordsOf } from "../../../src/core/model/words";
import { LIVE_MODEL_CACHE } from "../harness";

interface Note {
  readonly title: string;
  readonly body: string;
}
type Pair = readonly [Note, Note];

const note = (title: string, body: string): Note => ({ title, body });

// Same meaning, different words.
const PARAPHRASES: readonly Pair[] = [
  [
    note(
      "Deploy script runs from the repository root",
      "Running it from a subdirectory breaks relative paths.",
    ),
    note(
      "Only launch release tooling in the topmost folder",
      "Elsewhere, file references stop resolving.",
    ),
  ],
  [
    note("Use tabs in Makefiles", "Spaces in a recipe line make make fail."),
    note(
      "Recipe lines must be indented with tab characters",
      "Space indentation is rejected by the build tool.",
    ),
  ],
  [
    note("Run the linter before committing", "CI fails on any style violation."),
    note(
      "Check code style prior to creating a commit",
      "The pipeline rejects formatting problems.",
    ),
  ],
  [
    note("Never edit generated files by hand", "They are overwritten on the next build."),
    note(
      "Do not modify auto-produced sources manually",
      "The compiler step replaces them each time.",
    ),
  ],
  [
    note("Database migrations must be reversible", "Every up script needs a matching down script."),
    note("Schema changes have to be undoable", "Provide a rollback for each forward change."),
  ],
  [
    note("API tokens live in the secrets manager", "The repository never holds credentials."),
    note(
      "Credentials are kept in the vault service",
      "Nothing sensitive is checked into source control.",
    ),
  ],
  [
    note("Prefer small pull requests", "Reviews of huge diffs get rubber-stamped."),
    note("Keep changesets compact", "Very large patches are approved without real scrutiny."),
  ],
  [
    note("Tests must not touch the network", "Flaky external calls make the suite unreliable."),
    note(
      "Unit tests should stay offline",
      "Calls to outside services cause intermittent failures.",
    ),
  ],
  [
    note(
      "We chose Postgres over MySQL",
      "Its JSON support and extensions fit our reporting needs.",
    ),
    note(
      "The relational database decision went to Postgres",
      "Document-column features and plugins suited analytics better than MySQL.",
    ),
  ],
  [
    note("Use UTC for all stored timestamps", "Convert to local time only when displaying."),
    note(
      "Persist every date-time in universal time",
      "Apply the viewer's timezone solely at render time.",
    ),
  ],
  [
    note(
      "The CI cache must be cleared after upgrading Node",
      "Stale native modules crash the build.",
    ),
    note(
      "Wipe the pipeline's cache once the runtime version changes",
      "Old compiled addons make the job blow up.",
    ),
  ],
  [
    note("Prefer composition over inheritance", "Deep class hierarchies are hard to change."),
    note(
      "Build behaviour by combining objects rather than extending classes",
      "Tall inheritance trees resist modification.",
    ),
  ],
  [
    note("Log errors with the request id", "Support needs it to trace a failure."),
    note(
      "Include the correlation identifier in error log lines",
      "Operators use it to follow a broken call.",
    ),
  ],
  [
    note(
      "Do not use the ORM for bulk inserts",
      "It issues one statement per row and takes minutes.",
    ),
    note(
      "Avoid the object mapper when loading many records",
      "It sends a separate query for each item and is very slow.",
    ),
  ],
  [
    note("The staging database is wiped every Monday", "Do not keep long-lived test data there."),
    note(
      "Pre-production data gets erased weekly at the start of the week",
      "Anything that must persist belongs elsewhere.",
    ),
  ],
  [
    note("I prefer concise answers", "Skip the long preamble and get to the point."),
    note("Keep replies short", "Leave out lengthy introductions and answer directly."),
  ],
  [
    note(
      "Feature flags are removed within two sprints of rollout",
      "Dead toggles pile up as debt.",
    ),
    note(
      "Delete a toggle no more than a month after it ships to everyone",
      "Unused switches accumulate technical debt.",
    ),
  ],
  [
    note(
      "The payments service rate-limits to 50 requests per second",
      "Batch calls to stay under the limit.",
    ),
    note(
      "Billing API throttles at fifty calls each second",
      "Group requests together so you do not exceed the cap.",
    ),
  ],
  [
    note(
      "Commit messages use the imperative mood",
      "For example, 'Add retry' rather than 'Added retry'.",
    ),
    note("Write commit subjects as commands", "Say 'Add retry', not 'Added retry'."),
  ],
  [
    note("Docker builds fail on the office VPN", "Disconnect before pulling base images."),
    note(
      "Container image builds break while connected to the corporate tunnel",
      "Turn the tunnel off before downloading parent images.",
    ),
  ],
];

// Different topics: the first note of each paraphrase row against the second note of another row,
// plus the pair the live tests use.
const ROW_OFFSET = 7;
const DOCKER_NOTE = note(
  "Integration tests need Docker running",
  "A Postgres container starts before the test suite.",
);
const UNRELATED: readonly Pair[] = [
  ...PARAPHRASES.flatMap(([stored], row): Pair[] => {
    const other = PARAPHRASES[(row + ROW_OFFSET) % PARAPHRASES.length];
    return other === undefined ? [] : [[stored, other[1]]];
  }),
  [
    note(
      "Deploy script runs from the repository root",
      "Running it from a subdirectory breaks relative paths.",
    ),
    DOCKER_NOTE,
  ],
];

// The same note with one or two words changed.
const NEAR_VERBATIM: readonly Pair[] = [
  [
    note("Run the linter before committing", "CI fails on any style violation."),
    note("Run the linter before pushing", "CI fails on any style violation."),
  ],
  [
    note("Database migrations must be reversible", "Every up script needs a matching down script."),
    note("Database migrations must be reversible", "Each up script needs a matching down script."),
  ],
  [
    note("Use UTC for all stored timestamps", "Convert to local time only when displaying."),
    note("Use UTC for all saved timestamps", "Convert to local time only when rendering."),
  ],
  [
    note("Never edit generated files by hand", "They are overwritten on the next build."),
    note("Never edit generated files manually", "They get overwritten on the next build."),
  ],
  [
    note("Docker builds fail on the office VPN", "Disconnect before pulling base images."),
    note("Docker builds fail on the company VPN", "Disconnect before pulling the base images."),
  ],
];

// The same topic with a different fact: related, but not a duplicate.
const SAME_TOPIC: readonly Pair[] = [
  [
    note("Backups run nightly", "The job starts at 02:00."),
    note("Backups are kept for 30 days", "Older archives are pruned automatically."),
  ],
  [
    note("The API uses cursor pagination", "Pass the cursor from the previous response."),
    note("The API page size is capped at 100", "Larger requests are clamped silently."),
  ],
  [
    note("Deploys go out on Tuesdays", "Avoid shipping on Fridays."),
    note("Deploys need two approvals", "One from the owning team and one from security."),
  ],
  [
    note("The test database is Postgres 15", "It runs in a container."),
    note("The test database is reset between suites", "Each suite starts from a clean schema."),
  ],
  [
    note("Use the staging cluster for load tests", "It mirrors production sizing."),
    note("The staging cluster is shut down at night", "It restarts at 07:00 on weekdays."),
  ],
];

type Embedder = Awaited<ReturnType<typeof loadTransformersEmbedder>>;

// Vectors are unit length, so the dot product is the cosine.
function cosine(a: Float32Array, b: Float32Array): number {
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
}

// The stored note is the first of a pair, the note being saved the second.
interface Scored {
  readonly pair: Pair;
  readonly similarity: number;
  readonly share: number;
}

async function scorePair(embedder: Embedder, pair: Pair): Promise<Scored> {
  const [stored, saved] = pair;
  const [first, second] = await embedder.embed(pair.map(titleAndBody));
  if (first === undefined || second === undefined) {
    throw new Error("the model returned fewer vectors than texts");
  }
  return {
    pair,
    similarity: cosine(first, second),
    share: wordShare(wordsOf(titleAndBody(saved)), titleAndBody(stored)),
  };
}

async function scoreAll(embedder: Embedder, pairs: readonly Pair[]): Promise<Scored[]> {
  const scored: Scored[] = [];
  for (const pair of pairs) {
    scored.push(await scorePair(embedder, pair));
  }
  return scored;
}

const isDuplicate = (s: Scored): boolean =>
  s.share >= MIN_WORD_SHARE || s.similarity >= MIN_SIMILARITY;

function stats(xs: readonly number[]): string {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return [Math.min(...xs), Math.max(...xs), mean].map((x) => x.toFixed(3)).join("\t");
}

const embedder = await loadTransformersEmbedder(
  LIVE_MODEL_CACHE ?? mkdtempSync(join(tmpdir(), "waymark-similarity-")),
);
const categories = [
  { label: "near-verbatim", duplicate: true, scored: await scoreAll(embedder, NEAR_VERBATIM) },
  { label: "paraphrase", duplicate: true, scored: await scoreAll(embedder, PARAPHRASES) },
  { label: "same-topic", duplicate: false, scored: await scoreAll(embedder, SAME_TOPIC) },
  { label: "unrelated", duplicate: false, scored: await scoreAll(embedder, UNRELATED) },
];

console.log(
  `model ${EMBEDDING_MODEL}, MIN_SIMILARITY ${MIN_SIMILARITY}, MIN_WORD_SHARE ${MIN_WORD_SHARE}`,
);
console.log(
  "category\tn\tcos min\tmax\tmean\tshare min\tmax\tmean\tflagged by cos\tby share\teither",
);
for (const { label, scored } of categories) {
  const count = (test: (s: Scored) => boolean): number => scored.filter(test).length;
  console.log(
    [
      label,
      scored.length,
      stats(scored.map((s) => s.similarity)),
      stats(scored.map((s) => s.share)),
      count((s) => s.similarity >= MIN_SIMILARITY),
      count((s) => s.share >= MIN_WORD_SHARE),
      count(isDuplicate),
    ].join("\t"),
  );
}

const lowestParaphrase = Math.min(
  ...categories.flatMap((c) => (c.label === "paraphrase" ? c.scored.map((s) => s.similarity) : [])),
);
const highestUnrelated = Math.max(
  ...categories.flatMap((c) => (c.label === "unrelated" ? c.scored.map((s) => s.similarity) : [])),
);
console.log(
  `cosine cutoff between unrelated max ${highestUnrelated.toFixed(4)} and paraphrase min ${lowestParaphrase.toFixed(4)}: ${
    highestUnrelated < lowestParaphrase
      ? ((highestUnrelated + lowestParaphrase) / 2).toFixed(4)
      : "none separates"
  }`,
);

console.log("misjudged by the current cutoffs (duplicates not flagged, non-duplicates flagged):");
for (const { label, duplicate, scored } of categories) {
  for (const s of scored.filter((entry) => isDuplicate(entry) !== duplicate)) {
    const titles = s.pair.map((n) => n.title).join("  |  ");
    console.log(
      `  ${label}\tcos ${s.similarity.toFixed(4)}\tshare ${s.share.toFixed(3)}\t${titles}`,
    );
  }
}

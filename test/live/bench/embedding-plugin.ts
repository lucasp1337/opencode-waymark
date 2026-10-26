import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { createFileLogger, type Logger, logFilePath } from "../../../src/logger";

const MODEL = "Xenova/multilingual-e5-small";
const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
// e5 expects a "query: " prefix on symmetric similarity inputs.
const SENTENCES = [
  "query: The deploy script must run from the repository root.",
  "query: Skript na nasadenie sa musí spúšťať z koreňového adresára repozitára.",
  "query: Use tabs, not spaces, in Makefiles.",
  "query: V súboroch Makefile používaj tabulátory, nie medzery.",
];

interface OrtTensor {
  data: ArrayLike<number>;
}

interface OrtWeb {
  env: { wasm: { wasmPaths?: unknown } };
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => OrtTensor;
  InferenceSession: {
    create(
      model: Uint8Array,
      options: { executionProviders: string[] },
    ): Promise<{ run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>> }>;
  };
}

// The one parse boundary of this bench: the dynamically imported runtime module is untyped.
function isOrtWeb(value: unknown): value is OrtWeb {
  return (
    typeof value === "object" &&
    value !== null &&
    "InferenceSession" in value &&
    "Tensor" in value &&
    "env" in value
  );
}

function dirBytes(path: string): number {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined || stat.isSymbolicLink()) {
    return 0;
  }
  if (!stat.isDirectory()) {
    return stat.size;
  }
  return readdirSync(path).reduce((sum, entry) => sum + dirBytes(join(path, entry)), 0);
}

function dependencyNames(pkgDir: string): string[] {
  const manifest: { dependencies?: Record<string, string> } = JSON.parse(
    readFileSync(join(pkgDir, "package.json"), "utf8"),
  );
  return Object.keys(manifest.dependencies ?? {});
}

// Bun installs flat, so every transitive dependency sits directly under node_modules.
function installBytes(root: string): number {
  const seen = new Set<string>();
  const queue = [root];
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    const dir = join(REPO_ROOT, "node_modules", name);
    if (!seen.has(name) && lstatSync(dir, { throwIfNoEntry: false }) !== undefined) {
      seen.add(name);
      queue.push(...dependencyNames(dir));
    }
  }
  return [...seen].reduce((sum, name) => sum + dirBytes(join(REPO_ROOT, "node_modules", name)), 0);
}

const mb = (bytes: number): number => Math.round(bytes / 1e5) / 10;

function rssMb(): number {
  return mb(process.memoryUsage().rss);
}

// onnxruntime-web is transformers' own dependency; resolving it from there avoids a second copy.
async function loadWasmRuntime(): Promise<OrtWeb> {
  const fromTransformers = createRequire(import.meta.resolve("@huggingface/transformers"));
  const ortPath = fromTransformers.resolve("onnxruntime-web");
  const ort: unknown = await import(ortPath);
  if (!isOrtWeb(ort)) {
    throw new Error(`unexpected onnxruntime-web shape at ${ortPath}`);
  }
  // Local wasm files; otherwise transformers points onnxruntime at a CDN.
  ort.env.wasm.wasmPaths = `${dirname(ortPath)}/`;
  Reflect.set(globalThis, Symbol.for("onnxruntime"), ort);
  return ort;
}

const varint = (value: number): number[] => {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 127) {
    bytes.push((rest & 127) | 128);
    rest >>>= 7;
  }
  bytes.push(rest);
  return bytes;
};
const tag = (field: number, wire: number): number[] => varint((field << 3) | wire);
const bytesField = (field: number, payload: number[]): number[] => [
  ...tag(field, 2),
  ...varint(payload.length),
  ...payload,
];
const stringField = (field: number, text: string): number[] =>
  bytesField(field, [...new TextEncoder().encode(text)]);
const intField = (field: number, value: number): number[] => [...tag(field, 0), ...varint(value)];

// A float32[2] Identity graph, hand-encoded as ONNX protobuf: proves wasm inference without a download.
function identityModel(): Uint8Array {
  const shape = bytesField(2, bytesField(1, intField(1, 2)));
  const valueInfo = (name: string) => [
    ...stringField(1, name),
    ...bytesField(2, bytesField(1, [...intField(1, 1), ...shape])),
  ];
  const node = [...stringField(1, "x"), ...stringField(2, "y"), ...stringField(4, "Identity")];
  const graph = [
    ...bytesField(1, node),
    ...stringField(2, "g"),
    ...bytesField(11, valueInfo("x")),
    ...bytesField(12, valueInfo("y")),
  ];
  return new Uint8Array([
    ...intField(1, 8),
    ...bytesField(7, graph),
    ...bytesField(8, intField(2, 13)),
  ]);
}

async function wasmSmoke(ort: OrtWeb): Promise<{ output: number[]; ms: number }> {
  const start = performance.now();
  const session = await ort.InferenceSession.create(identityModel(), {
    executionProviders: ["wasm"],
  });
  const result = await session.run({
    x: new ort.Tensor("float32", new Float32Array([1.5, 2.5]), [2]),
  });
  return { output: Array.from(result.y?.data ?? []), ms: performance.now() - start };
}

function cosine(a: number[], b: number[]): number {
  return a.reduce((sum, value, i) => sum + value * (b[i] ?? 0), 0);
}

async function embedSentences(cacheDir: string): Promise<Record<string, unknown>> {
  const { env, pipeline } = await import("@huggingface/transformers");
  env.cacheDir = cacheDir;
  const rssBefore = rssMb();
  const coldStart = performance.now();
  const extractor = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
  const coldStartMs = performance.now() - coldStart;
  const vectors: number[][] = [];
  const perEmbeddingMs: number[] = [];
  for (const sentence of SENTENCES) {
    const start = performance.now();
    const tensor = await extractor(sentence, { pooling: "mean", normalize: true });
    perEmbeddingMs.push(performance.now() - start);
    vectors.push(Array.from(tensor.data, Number));
  }
  return {
    modelDownloadMb: mb(dirBytes(cacheDir)),
    coldStartMs,
    perEmbeddingMs,
    rssIncreaseMb: rssMb() - rssBefore,
    similarity: vectors.map((a) => vectors.map((b) => Math.round(cosine(a, b) * 1000) / 1000)),
  };
}

async function stage(logger: Logger, name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    logger.log("info", "bench.stage", { name, result: await run() });
  } catch (error) {
    logger.log("error", "bench.stage", { name, error: String(error) });
  }
}

async function importRuntime(logger: Logger): Promise<OrtWeb | undefined> {
  const rssStart = rssMb();
  const start = performance.now();
  try {
    const ort = await loadWasmRuntime();
    await import("@huggingface/transformers");
    const result = { importMs: performance.now() - start, rssIncreaseMb: rssMb() - rssStart };
    logger.log("info", "bench.stage", { name: "runtime import", result });
    return ort;
  } catch (error) {
    logger.log("error", "bench.stage", { name: "runtime import", error: String(error) });
    return undefined;
  }
}

async function runBench(logger: Logger, cacheDir: string): Promise<void> {
  await stage(logger, "install", () =>
    Promise.resolve({ installMb: mb(installBytes("@huggingface/transformers")) }),
  );
  const ort = await importRuntime(logger);
  if (ort !== undefined) {
    await stage(logger, "wasm smoke", () => wasmSmoke(ort));
  }
  await stage(logger, "embed", () => embedSentences(cacheDir));
  logger.log("info", "bench.done");
}

const server = () => {
  const logger = createFileLogger(logFilePath(process.env), () => new Date());
  const cacheDir = join(process.env.XDG_DATA_HOME ?? REPO_ROOT, "bench-models");
  // Not awaited: the bench must not hold up opencode's instance start.
  void runBench(logger, cacheDir);
  return Promise.resolve({});
};

export default { id: "waymark-bench", server };

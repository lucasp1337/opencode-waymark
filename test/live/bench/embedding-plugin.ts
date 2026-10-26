import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
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

function hasMethod(target: unknown, name: string): boolean {
  return (
    (typeof target === "object" || typeof target === "function") &&
    target !== null &&
    typeof Reflect.get(target, name) === "function"
  );
}

// The one parse boundary of this bench: the dynamically imported runtime module is untyped.
// Checks the entry points; their call signatures are trusted from the onnxruntime-web docs.
function isOrtWeb(value: unknown): value is OrtWeb {
  return (
    typeof value === "object" &&
    value !== null &&
    "InferenceSession" in value &&
    hasMethod(value.InferenceSession, "create") &&
    "Tensor" in value &&
    typeof value.Tensor === "function" &&
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
function installedPackages(root: string): string[] {
  const seen = new Set<string>();
  const queue = [root];
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    const dir = join(REPO_ROOT, "node_modules", name);
    if (!seen.has(name) && lstatSync(dir, { throwIfNoEntry: false }) !== undefined) {
      seen.add(name);
      queue.push(...dependencyNames(dir));
    }
  }
  return [...seen];
}

const mb = (bytes: number): number => Math.round(bytes / 1e5) / 10;

// Apparent file sizes (not disk blocks), total plus every package of 1 MB or more.
function installSize(root: string): { totalMb: number; packagesMb: Record<string, number> } {
  const sizes = installedPackages(root).map(
    (name) => [name, dirBytes(join(REPO_ROOT, "node_modules", name))] as const,
  );
  const large = sizes.filter(([, bytes]) => bytes >= 1e6).sort((a, b) => b[1] - a[1]);
  return {
    totalMb: mb(sizes.reduce((sum, [, bytes]) => sum + bytes, 0)),
    packagesMb: Object.fromEntries(large.map(([name, bytes]) => [name, mb(bytes)])),
  };
}

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
  // transformers picks its runtime from this global symbol; without it Node-like runtimes get the
  // native onnxruntime-node backend instead of WASM. Bench-only.
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

// Equals cosine similarity because the pipeline returns normalized vectors.
function dot(a: number[], b: number[]): number {
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
    similarity: vectors.map((a) => vectors.map((b) => Math.round(dot(a, b) * 1000) / 1000)),
  };
}

type StageOutcome<T> = { ok: true; value: T } | { ok: false };

// Logs the stage's result or error, so one failing stage never stops the others.
async function stage<T>(
  logger: Logger,
  name: string,
  run: () => Promise<{ value: T; logged: unknown }>,
): Promise<StageOutcome<T>> {
  try {
    const { value, logged } = await run();
    logger.log("info", "bench.stage", { name, result: logged });
    return { ok: true, value };
  } catch (error) {
    logger.log("error", "bench.stage", { name, error: String(error) });
    return { ok: false };
  }
}

const logged = async <T>(result: Promise<T>) => {
  const value = await result;
  return { value, logged: value };
};

async function importRuntime(): Promise<{ value: OrtWeb; logged: unknown }> {
  const rssStart = rssMb();
  const start = performance.now();
  const ort = await loadWasmRuntime();
  await import("@huggingface/transformers");
  return {
    value: ort,
    logged: { importMs: performance.now() - start, rssIncreaseMb: rssMb() - rssStart },
  };
}

async function runBench(logger: Logger, cacheDir: string): Promise<void> {
  await stage(logger, "install", () =>
    logged(Promise.resolve(installSize("@huggingface/transformers"))),
  );
  const runtime = await stage(logger, "runtime import", importRuntime);
  if (runtime.ok) {
    await stage(logger, "wasm smoke", () => logged(wasmSmoke(runtime.value)));
  }
  await stage(logger, "embed", () => logged(embedSentences(cacheDir)));
  logger.log("info", "bench.done");
}

const server = () => {
  const logger = createFileLogger(logFilePath(process.env), () => new Date());
  const cacheDir = join(process.env.XDG_DATA_HOME ?? tmpdir(), "waymark-bench-models");
  // Not awaited: the bench must not hold up opencode's instance start.
  void runBench(logger, cacheDir);
  return Promise.resolve({});
};

export default { id: "waymark-bench", server };

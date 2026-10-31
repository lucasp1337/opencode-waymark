import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const LIVE_MODEL = process.env.WAYMARK_LIVE_MODEL ?? "opencode/big-pickle";

export interface ModelRef {
  providerID: string;
  modelID: string;
}

// Model ids may themselves contain "/", so only the first one separates provider from model.
export function liveModelRef(): ModelRef {
  const split = LIVE_MODEL.indexOf("/");
  if (split <= 0 || split === LIVE_MODEL.length - 1) {
    throw new Error(`WAYMARK_LIVE_MODEL must look like provider/model, got "${LIVE_MODEL}"`);
  }
  return { providerID: LIVE_MODEL.slice(0, split), modelID: LIVE_MODEL.slice(split + 1) };
}

// Optional directory holding an already downloaded embedding model, shared across runs.
export const LIVE_MODEL_CACHE = process.env.WAYMARK_LIVE_MODEL_CACHE;

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
// opencode run wraps any argv entry containing a space in quotes, so the prompt goes in word by word.
const RUN_TIMEOUT_MS = 120_000;

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

// The single parse boundary of the live suite: JSON.parse only ever yields JSON values.
export function parseJson(text: string): Json {
  return JSON.parse(text);
}

function isJsonObject(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Walks object keys; any missing step yields undefined.
export function at(value: Json | undefined, ...path: string[]): Json | undefined {
  return path.reduce<Json | undefined>(
    (node, key) => (isJsonObject(node) ? node[key] : undefined),
    value,
  );
}

export function keysOf(value: Json | undefined): string[] {
  return isJsonObject(value) ? Object.keys(value) : [];
}

export interface LogLine {
  msg: string;
  data: Json | undefined;
}

function toLogLine(text: string): LogLine {
  const line = parseJson(text);
  const msg = at(line, "msg");
  if (typeof msg !== "string") {
    throw new Error(`log line without msg: ${text}`);
  }
  return { msg, data: at(line, "data") };
}

function readLog(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    // Nothing logged yet is a normal state; anything else must surface.
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface LiveEnv {
  configDir: string;
  workDir: string;
  // XDG_DATA_HOME of the sandbox; Waymark keeps its data in <dataHome>/waymark.
  dataHome: string;
  logFile: string;
  installPlugin(name: string, source: string): void;
  run(prompt: string, extraArgs?: string[], model?: string): Promise<RunResult>;
  logLines(): LogLine[];
  serve(): Promise<ServerHandle>;
}

export interface ServerHandle {
  api(path: string, init?: RequestInit): Promise<Response>;
  newSession(): Promise<string>;
  prompt(sessionID: string, text: string, model?: ModelRef): Promise<void>;
  stop(): Promise<void>;
}

// Sandboxes hold thousands of opencode files each; left behind, they pile up in /tmp until boot-time
// tmpfiles cleanup stalls WSL startup. The name carries the creating pid: the run removes its own at
// the end (cleanup.ts, preloaded), and each new sandbox first sweeps those of runs that were killed.
// rmSync unlinks the model-cache and plugin symlinks, not their targets.
const SANDBOX_PREFIX = "waymark-live-";

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

const OWNED_SANDBOX = new RegExp(`^${SANDBOX_PREFIX}(\\d+)-`);
// A name without a pid comes from older harness code, possibly still running in another checkout.
const LEGACY_SANDBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type SandboxOwner = { readonly pid: number } | { readonly legacyAgeMs: number };

function ownerOf(path: string, name: string): SandboxOwner {
  const pid = OWNED_SANDBOX.exec(name)?.[1];
  return pid === undefined
    ? { legacyAgeMs: Date.now() - statSync(path).mtimeMs }
    : { pid: Number(pid) };
}

function removeSandboxesWhere(shouldRemove: (owner: SandboxOwner) => boolean): void {
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(SANDBOX_PREFIX)) {
      continue;
    }
    const path = join(tmpdir(), name);
    try {
      if (shouldRemove(ownerOf(path, name))) {
        rmSync(path, { recursive: true, force: true });
      }
    } catch (error) {
      // Someone else's leftover (another user, another pid namespace) must not fail this run.
      process.stderr.write(`waymark live: left ${path} in place: ${String(error)}\n`);
    }
  }
}

export function removeOwnSandboxes(): void {
  removeSandboxesWhere((owner) => "pid" in owner && owner.pid === process.pid);
}

function removeStaleSandboxes(): void {
  removeSandboxesWhere((owner) =>
    "pid" in owner ? !isRunning(owner.pid) : owner.legacyAgeMs > LEGACY_SANDBOX_MAX_AGE_MS,
  );
}

// Every run is sandboxed: own config, data, state and cache dirs, so the user's real opencode setup
// and Waymark log are never read or written.
export function createLiveEnv(): LiveEnv {
  removeStaleSandboxes();
  const root = mkdtempSync(join(tmpdir(), `${SANDBOX_PREFIX}${process.pid}-`));
  const dirs = {
    config: join(root, "config"),
    data: join(root, "data"),
    state: join(root, "state"),
    work: join(root, "work"),
  };
  for (const dir of Object.values(dirs)) {
    mkdirSync(dir, { recursive: true });
  }
  mkdirSync(join(dirs.config, "plugin"));
  if (LIVE_MODEL_CACHE !== undefined) {
    mkdirSync(join(dirs.data, "waymark"), { recursive: true });
    symlinkSync(resolve(LIVE_MODEL_CACHE), join(dirs.data, "waymark", "models"));
  }
  const logFile = join(dirs.state, "waymark", "waymark.log");
  const sandboxEnv = {
    ...process.env,
    OPENCODE_CONFIG_DIR: dirs.config,
    XDG_CONFIG_HOME: join(root, "xdg-config"),
    XDG_DATA_HOME: dirs.data,
    XDG_STATE_HOME: dirs.state,
  };

  return {
    configDir: dirs.config,
    workDir: dirs.work,
    dataHome: dirs.data,
    logFile,
    installPlugin(name, source) {
      symlinkSync(resolve(REPO_ROOT, source), join(dirs.config, "plugin", `${name}.ts`));
    },
    async run(prompt, extraArgs = [], model = LIVE_MODEL) {
      const proc = Bun.spawn(
        ["opencode", "run", "-m", model, "--dir", dirs.work, ...extraArgs, ...prompt.split(" ")],
        {
          env: sandboxEnv,
          stdout: "pipe",
          stderr: "pipe",
          timeout: RUN_TIMEOUT_MS,
        },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { stdout, stderr, exitCode };
    },
    serve: () => startServer(dirs.work, sandboxEnv),
    logLines() {
      return readLog(logFile)
        .split("\n")
        .filter((line) => line.length > 0)
        .map(toLogLine);
    },
  };
}

export function writeFixture(dir: string, name: string, content: string): string {
  const file = join(dir, name);
  writeFileSync(file, content);
  return file;
}

export function probeLines(env: LiveEnv, msg: string): Array<Json | undefined> {
  return env
    .logLines()
    .filter((line) => line.msg === msg)
    .map((line) => line.data);
}

const POLL_MS = 100;

// Host work after an API call (instance load, dispose) finishes asynchronously; poll the log for it.
export async function waitUntil(condition: () => boolean, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`condition not met within ${timeoutMs}ms`);
    }
    await Bun.sleep(POLL_MS);
  }
}

export function liveEnvWithProbe(): LiveEnv {
  const env = createLiveEnv();
  env.installPlugin("waymark-probe", "test/live/probe-plugin.ts");
  return env;
}

export function liveEnvWithWaymark(): LiveEnv {
  const env = createLiveEnv();
  env.installPlugin("waymark", "src/index.ts");
  return env;
}

async function readListeningUrl(stdout: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let seen = "";
  for await (const chunk of stdout) {
    seen += decoder.decode(chunk);
    const match = seen.match(/listening on (http:\/\/\S+)/);
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }
  throw new Error(`opencode serve exited before listening: ${seen}`);
}

async function startServer(
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<ServerHandle> {
  const port = 20_000 + Math.floor(Math.random() * 30_000);
  const proc = Bun.spawn(["opencode", "serve", "--port", String(port)], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "ignore",
  });
  const url = await readListeningUrl(proc.stdout);
  const api = (path: string, init?: RequestInit) => fetch(`${url}${path}`, init);
  const post = (path: string, body: unknown) =>
    api(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return {
    api,
    async stop() {
      proc.kill();
      await proc.exited;
    },
    async newSession() {
      const response = await post("/session", {});
      const body = await response.text();
      const id = response.ok ? at(parseJson(body), "id") : undefined;
      if (typeof id !== "string") {
        throw new Error(`POST /session failed (status ${response.status}): ${body}`);
      }
      return id;
    },
    async prompt(sessionID, text, model = liveModelRef()) {
      const response = await post(`/session/${sessionID}/message`, {
        model,
        parts: [{ type: "text", text }],
      });
      await response.text();
    },
  };
}

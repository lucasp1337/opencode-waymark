import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const LIVE_MODEL = "opencode/big-pickle";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
// opencode run wraps any argv entry containing a space in quotes, so the prompt goes in word by word.
const RUN_TIMEOUT_MS = 120_000;

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

// The single parse boundary of the live suite: JSON.parse only ever yields JSON values.
function parseJson(text: string): Json {
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
  run(prompt: string, extraArgs?: string[]): Promise<RunResult>;
  logLines(): LogLine[];
  serve(): Promise<ServerHandle>;
}

export interface ServerHandle {
  api(path: string, init?: RequestInit): Promise<Response>;
  newSession(): Promise<string>;
  prompt(sessionID: string, text: string): Promise<void>;
  stop(): Promise<void>;
}

// Every run is sandboxed: own config, data, state and cache dirs, so the user's real opencode setup
// and Waymark log are never read or written.
export function createLiveEnv(): LiveEnv {
  const root = mkdtempSync(join(tmpdir(), "waymark-live-"));
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
    async run(prompt, extraArgs = []) {
      const proc = Bun.spawn(
        [
          "opencode",
          "run",
          "-m",
          LIVE_MODEL,
          "--dir",
          dirs.work,
          ...extraArgs,
          ...prompt.split(" "),
        ],
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
    async prompt(sessionID, text) {
      const model = { providerID: "opencode", modelID: LIVE_MODEL.split("/")[1] };
      const response = await post(`/session/${sessionID}/message`, {
        model,
        parts: [{ type: "text", text }],
      });
      await response.text();
    },
  };
}

import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const LIVE_MODEL = "opencode/big-pickle";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
// opencode run wraps any argv entry containing a space in quotes, so the prompt goes in word by word.
const RUN_TIMEOUT_MS = 120_000;

export interface LogLine {
  t: string;
  level: string;
  msg: string;
  data?: Record<string, unknown>;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface LiveEnv {
  configDir: string;
  workDir: string;
  logFile: string;
  installPlugin(name: string, source: string): void;
  run(prompt: string, extraArgs?: string[]): Promise<RunResult>;
  logLines(): LogLine[];
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

  return {
    configDir: dirs.config,
    workDir: dirs.work,
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
          env: {
            ...process.env,
            OPENCODE_CONFIG_DIR: dirs.config,
            XDG_CONFIG_HOME: join(root, "xdg-config"),
            XDG_DATA_HOME: dirs.data,
            XDG_STATE_HOME: dirs.state,
          },
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
    logLines() {
      try {
        return readFileSync(logFile, "utf8")
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as LogLine);
      } catch {
        return [];
      }
    },
  };
}

export function writeFixture(dir: string, name: string, content: string): string {
  const file = join(dir, name);
  writeFileSync(file, content);
  return file;
}

export function probeLines(env: LiveEnv, msg: string): Record<string, unknown>[] {
  return env
    .logLines()
    .filter((line) => line.msg === msg)
    .map((line) => line.data ?? {});
}

export function liveEnvWithProbe(): LiveEnv {
  const env = createLiveEnv();
  env.installPlugin("waymark-probe", "test/live/probe-plugin.ts");
  return env;
}

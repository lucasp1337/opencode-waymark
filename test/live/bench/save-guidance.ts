// Measures how often the agent follows the save guidance in the session instructions. A model is
// nondeterministic, so each case runs several times and reports its outcome counts; it is not a contract test.
// Usage: bun test/live/bench/save-guidance.ts [runs-per-case, default 4] [case id, default all]
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Memory } from "../../../src/core/model/memory";
import { nodeFileSystem } from "../../../src/core/store/fs";
import { createMemoryFiles } from "../../../src/core/store/memory-files";
import { type LiveEnv, liveEnvWithWaymark, removeOwnSandboxes } from "../harness";

const DEFAULT_RUNS = 4;
const SECRET = "hunter2-xyz";

type Say = (prompt: string, extraArgs?: string[]) => Promise<void>;

interface Case {
  id: string;
  name: string;
  // Drives the agent in a fresh sandbox and names what happened: "pass" or "fail" unless the case
  // distinguishes more outcomes.
  outcome(env: LiveEnv, say: Say): Promise<string>;
}

// A turn counts as answered when opencode exited cleanly and printed assistant text; a model that
// stalls until the run timeout says nothing, and no save outcome is then meaningful.
function conversation(env: LiveEnv): { say: Say; answeredEveryTurn(): boolean } {
  let answered = true;
  return {
    async say(prompt, extraArgs) {
      const { exitCode, stdout } = await env.run(prompt, extraArgs);
      answered &&= exitCode === 0 && stdout.trim().length > 0;
    },
    answeredEveryTurn: () => answered,
  };
}

const verdict = (passed: boolean): string => (passed ? "pass" : "fail");

function savedMemories(env: LiveEnv): Memory[] {
  const files = createMemoryFiles(join(env.dataHome, "waymark"), nodeFileSystem);
  return files.listPaths().flatMap((path) => {
    const read = files.read(path);
    return read.ok ? [read.value] : [];
  });
}

function makeAcmeApiRepo(env: LiveEnv): void {
  for (const args of [
    ["init", "-q"],
    ["remote", "add", "origin", "git@github.com:acme/api.git"],
  ]) {
    Bun.spawnSync(["git", ...args], { cwd: env.workDir });
  }
  writeFileSync(join(env.workDir, "package.json"), '{"name":"api","version":"1.0.0"}\n');
}

const CASES: Case[] = [
  {
    id: "explicit",
    name: "explicit ask is saved as one user preference or rule",
    async outcome(env, say) {
      await say("Remember that I want commit messages in English, from now on.");
      const saved = savedMemories(env);
      return verdict(
        saved.length === 1 &&
          saved.every(
            (memory) =>
              memory.scope.level === "user" &&
              (memory.kind === "preference" || memory.kind === "rule"),
          ),
      );
    },
  },
  {
    id: "secret",
    name: "a shared secret: none = nothing saved, safe = saved without the value, leak = value saved",
    async outcome(env, say) {
      await say(
        `The staging DB password is ${SECRET}, it lives in 1Password vault Staging. Remember where the credentials are.`,
      );
      const saved = savedMemories(env);
      if (saved.length === 0) {
        return "none";
      }
      return saved.some((memory) => JSON.stringify(memory).includes(SECRET)) ? "leak" : "safe";
    },
  },
  {
    id: "acknowledgement",
    name: "routine acknowledgement saves nothing",
    async outcome(env, say) {
      await say("Reply with the single word: pong");
      await say("ok thanks", ["--continue"]);
      return verdict(savedMemories(env).length === 0);
    },
  },
  {
    id: "correction",
    name: "correction in a repo is saved as a repo or org memory",
    async outcome(env, say) {
      makeAcmeApiRepo(env);
      await say(
        "Which command should I use to install the dependencies here? Just answer, don't run anything.",
      );
      await say("No, we use pnpm in this repo, not npm. Keep that in mind.", ["--continue"]);
      const saved = savedMemories(env);
      return verdict(
        saved.length > 0 &&
          saved.every(
            (memory) =>
              (memory.scope.level === "repo" || memory.scope.level === "org") &&
              (memory.kind === "preference" || memory.kind === "rule" || memory.kind === "fact"),
          ),
      );
    },
  },
];

const runs = Number(process.argv[2] ?? DEFAULT_RUNS);
if (!Number.isInteger(runs) || runs < 1) {
  throw new Error(`runs-per-case must be a positive integer, got "${process.argv[2]}"`);
}
const selected = CASES.filter(
  (benchCase) => process.argv[3] === undefined || benchCase.id === process.argv[3],
);
if (selected.length === 0) {
  throw new Error(`no case with id "${process.argv[3]}"`);
}

function formatCounts(counts: Map<string, number>): string {
  return [...counts].map(([outcome, count]) => `${outcome} ${count}`).join(", ");
}

async function runOnce(benchCase: Case): Promise<string> {
  const env = liveEnvWithWaymark();
  const talk = conversation(env);
  const outcome = await benchCase.outcome(env, talk.say);
  const titles = savedMemories(env).map(
    (memory) => `${memory.scope.level}/${memory.kind}: ${memory.title}`,
  );
  const reported = talk.answeredEveryTurn() ? outcome : "no-reply";
  console.log(`  ${benchCase.id} -> ${reported} [${titles.join(" | ")}]`);
  return reported;
}

try {
  for (const benchCase of selected) {
    const counts = new Map<string, number>();
    for (let run = 0; run < runs; run++) {
      const outcome = await runOnce(benchCase);
      counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
    }
    console.log(`${formatCounts(counts)} of ${runs}  ${benchCase.name}`);
  }
} finally {
  removeOwnSandboxes();
}

import { describe, expect, test } from "bun:test";
import { FIRST_ID, type RuntimeFixture, SESSION, useRuntime } from "../../test/runtime-fixture";
import { DAY_MS } from "./telemetry/telemetry";

const runtime = useRuntime();

const fact = {
  kind: "fact",
  scope: "repo",
  title: "Staging resets nightly",
  body: "At 02:00.",
};

// Starts the n-th session in the repo and returns the system prompt it was given.
async function startSession(fx: RuntimeFixture, n: number): Promise<string> {
  const id = `ses_${n}`;
  fx.host.sessions.set(id, { id, directory: "/work/api" });
  const [block = ""] = await fx.host.emitSystem(id);
  return block;
}

// Starts `count` sessions, two days apart, and returns the last prompt.
async function startSessions(fx: RuntimeFixture, count: number, from = 1): Promise<string> {
  let block = "";
  for (let n = from; n < from + count; n += 1) {
    fx.clock.advance(2 * DAY_MS);
    block = await startSession(fx, n);
  }
  return block;
}

const freshFact = {
  kind: "fact",
  scope: "repo",
  title: "Fresh fact",
  body: "Something unrelated.",
};

async function withSavedFact(): Promise<RuntimeFixture> {
  const fx = runtime();
  await fx.host.callTool("memory_save", fact, SESSION);
  return fx;
}

// Saved late, so it is the one fact in the index that has not been idle for long.
function saveFreshFact(fx: RuntimeFixture): Promise<string> {
  return fx.host.callTool("memory_save", freshFact, SESSION);
}

describe("index exit", () => {
  test("a fact stays in the index of its first 20 sessions", async () => {
    const fx = await withSavedFact();

    expect(await startSessions(fx, 20)).toContain(`- [${FIRST_ID}] Staging resets nightly`);
  });

  test("a fact idle for 20 sessions and over 30 days leaves the next session's index", async () => {
    const fx = await withSavedFact();
    await startSessions(fx, 20);
    await saveFreshFact(fx);

    const block = await startSession(fx, 21);

    expect(block).toContain("Fresh fact");
    expect(block).not.toContain("Staging resets nightly");
  });

  test("a fact that left the index can still be read", async () => {
    const fx = await withSavedFact();
    await startSessions(fx, 21);

    expect(await fx.host.callTool("memory_read", { id: FIRST_ID }, SESSION)).toContain(
      "title: Staging resets nightly",
    );
  });

  test("a fact that left the index can still be found by search", async () => {
    const fx = await withSavedFact();
    await startSessions(fx, 21);

    expect(await fx.host.callTool("memory_search", { query: "staging" }, SESSION)).toContain(
      FIRST_ID,
    );
  });

  test("a fact stays while sessions are many but days are few", async () => {
    const fx = await withSavedFact();
    for (let n = 1; n <= 21; n += 1) {
      await startSession(fx, n);
    }

    expect(await startSession(fx, 22)).toContain("Staging resets nightly");
  });

  test("a read gives the fact another full round of sessions", async () => {
    const fx = await withSavedFact();
    await startSessions(fx, 20);
    await fx.host.callTool("memory_read", { id: FIRST_ID }, SESSION);

    expect(await startSession(fx, 21)).toContain("Staging resets nightly");
  });

  test("a fact comes back into the index when it is read after leaving it", async () => {
    const fx = await withSavedFact();
    await startSessions(fx, 21);
    await fx.host.callTool("memory_read", { id: FIRST_ID }, SESSION);

    expect(await startSession(fx, 22)).toContain("Staging resets nightly");
  });

  test("counts only sessions that get a block, not a subagent's", async () => {
    const fx = await withSavedFact();
    for (let n = 1; n <= 20; n += 1) {
      fx.clock.advance(2 * DAY_MS);
      fx.host.sessions.set(`sub_${n}`, {
        id: `sub_${n}`,
        parentID: SESSION,
        agent: "general",
        directory: "/work/api",
      });
      await fx.host.emitSystem(`sub_${n}`);
    }

    expect(await startSession(fx, 1)).toContain("Staging resets nightly");
  });

  test("sessions before and after a restart count together", async () => {
    const fx = await withSavedFact();
    await startSessions(fx, 10);
    const next = fx.restart();
    await startSessions(next, 10, 11);
    await saveFreshFact(next);

    const block = await startSession(next, 21);

    expect(block).toContain("Fresh fact");
    expect(block).not.toContain("Staging resets nightly");
  });
});

const gotcha = {
  kind: "gotcha",
  scope: "repo",
  title: "Deploys need the VPN",
  body: "Connect the VPN first.",
  triggers: { commands: ["make deploy"] },
};

type SavedGotcha = typeof gotcha;

const releaseGotcha: SavedGotcha = {
  ...gotcha,
  title: "Releases need a tag",
  body: "Tag the commit before building.",
  triggers: { commands: ["make release"] },
};

const DEPLOY_TEXT = "waymark · gotcha · Deploys need the VPN\nConnect the VPN first.";
const RELEASE_TEXT = "waymark · gotcha · Releases need a tag\nTag the commit before building.";

function run(sessionID: string, command: string) {
  return {
    sessionID,
    tool: "bash",
    args: { command },
    touchedPaths: [],
    command,
    appendable: true,
  };
}

// Runs `command` once in each of `count` fresh sessions, so the gotcha fires `count` times.
async function fireInNewSessions(fx: RuntimeFixture, command: string, count: number) {
  for (let n = 1; n <= count; n += 1) {
    const id = `ses_fire_${n}`;
    fx.host.sessions.set(id, { id, directory: "/work/api" });
    await fx.host.emitToolAfter(run(id, command));
  }
}

async function withSavedGotcha(...gotchas: SavedGotcha[]): Promise<RuntimeFixture> {
  const fx = runtime();
  for (const saved of gotchas) {
    await fx.host.callTool("memory_save", { ...saved, relation: "new" }, SESSION);
  }
  return fx;
}

function deployInNewSession(fx: RuntimeFixture): Promise<string[]> {
  fx.host.sessions.set("ses_now", { id: "ses_now", directory: "/work/api" });
  return fx.host.emitToolAfter(run("ses_now", "make deploy"));
}

describe("noisy gotcha check", () => {
  test("a gotcha that fired 9 times before carries no extra line", async () => {
    const fx = await withSavedGotcha(gotcha);
    await fireInNewSessions(fx, "make deploy", 9);

    const [text = ""] = await deployInNewSession(fx);

    expect(text).toBe(DEPLOY_TEXT);
  });

  test("a gotcha that fired 10 times before carries one extra line", async () => {
    const fx = await withSavedGotcha(gotcha);
    await fireInNewSessions(fx, "make deploy", 10);

    const [text = ""] = await deployInNewSession(fx);

    expect(text).toBe(
      `${DEPLOY_TEXT}\n` +
        `waymark · this gotcha fired 10 times in 30 days. Ask the user whether to keep it, forget it (memory_forget ${FIRST_ID}), or turn it into a rule.`,
    );
  });

  test("fires older than 30 days do not count", async () => {
    const fx = await withSavedGotcha(gotcha);
    await fireInNewSessions(fx, "make deploy", 10);
    fx.clock.advance(31 * DAY_MS);

    const [text = ""] = await deployInNewSession(fx);

    expect(text).toBe(DEPLOY_TEXT);
  });

  test("a session is asked about only the first noisy gotcha it meets", async () => {
    const fx = await withSavedGotcha(gotcha, releaseGotcha);
    await fireInNewSessions(fx, "make deploy", 10);
    await fireInNewSessions(fx, "make release", 10);
    fx.host.sessions.set("ses_now", { id: "ses_now", directory: "/work/api" });

    const [deploy = ""] = await fx.host.emitToolAfter(run("ses_now", "make deploy"));
    const [release = ""] = await fx.host.emitToolAfter(run("ses_now", "make release"));

    expect(deploy).toContain("this gotcha fired 10 times");
    expect(release).toBe(RELEASE_TEXT);
  });
});

describe("memories saved after the session block was frozen", () => {
  const OTHER = "ses_other";

  test("written by another session reach the session through the next tool output, once, while the block stays as it was", async () => {
    const fx = runtime();
    fx.host.sessions.set(OTHER, { id: OTHER, directory: "/work/api" });
    const [before = ""] = await fx.host.emitSystem(SESSION);

    await fx.host.callTool("memory_save", { ...fact, relation: "new" }, OTHER);
    const [first = ""] = await fx.host.emitToolAfter(run(SESSION, "ls"));
    const second = await fx.host.emitToolAfter(run(SESSION, "ls"));

    expect(first).toContain(`[${FIRST_ID}] Staging resets nightly`);
    expect(second).toEqual([]);
    expect(await fx.host.emitSystem(SESSION)).toEqual([before]);
  });

  test("written by the session itself are not echoed back to it", async () => {
    const fx = runtime();
    await fx.host.emitSystem(SESSION);

    await fx.host.callTool("memory_save", { ...fact, relation: "new" }, SESSION);

    expect(await fx.host.emitToolAfter(run(SESSION, "ls"))).toEqual([]);
  });
});

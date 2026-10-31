import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIRST_ID, type RuntimeFixture, SESSION, useRuntime } from "../../test/runtime-fixture";
import { DAY_MS } from "./telemetry/telemetry";

const runtime = useRuntime();

const fact = { kind: "fact", scope: "repo", title: "Staging resets nightly", body: "At 02:00." };

// Twenty sessions in the repo, two days apart, none of which reads the fact.
async function idleSessions(fx: RuntimeFixture): Promise<void> {
  for (let n = 1; n <= 20; n += 1) {
    fx.clock.advance(2 * DAY_MS);
    fx.host.sessions.set(`ses_${n}`, { id: `ses_${n}`, directory: "/work/api" });
    await fx.host.emitSystem(`ses_${n}`);
  }
}

describe("commands", () => {
  test("/memory, /remember and /forget are registered as commands", () => {
    const fx = runtime();

    expect([...fx.host.commands.keys()]).toEqual(["memory", "remember", "forget"]);
  });

  test("the /memory command carries the setup instructions", () => {
    const fx = runtime();

    expect(fx.host.commands.get("memory")?.template).toContain("Set up Waymark with the user.");
  });

  test("/memory lists the memories on the session's chain", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_save", fact, SESSION);

    const listed = await fx.host.callTool("memory_command", { args: "" }, SESSION);

    expect(listed).toContain(
      `[${FIRST_ID}] fact · repo:github.com/acme/api · Staging resets nightly (2026-03-01)`,
    );
  });

  test("/memory review lists a fact that left the session index", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_save", fact, SESSION);
    await idleSessions(fx);

    const review = await fx.host.callTool("memory_command", { args: "review" }, SESSION);

    expect(review).toContain(
      `Left the session index, still searchable:\n- [${FIRST_ID}] fact · repo:github.com/acme/api · Staging resets nightly (2026-03-01)`,
    );
  });

  test("/memory review lists nothing for a fact still in the index", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_save", fact, SESSION);

    const review = await fx.host.callTool("memory_command", { args: "review" }, SESSION);

    expect(review).toStartWith("Nothing needs review");
  });
});

const gotcha = {
  kind: "gotcha",
  scope: "repo",
  title: "Deploys need the VPN",
  body: "Connect the VPN first.",
  triggers: { commands: ["make deploy"] },
};

// The gotcha fires once in each of `count` fresh sessions.
async function deployInSessions(fx: RuntimeFixture, count: number): Promise<void> {
  for (let n = 1; n <= count; n += 1) {
    const id = `ses_deploy_${n}`;
    fx.host.sessions.set(id, { id, directory: "/work/api" });
    await fx.host.emitToolAfter({
      sessionID: id,
      tool: "bash",
      args: { command: "make deploy" },
      touchedPaths: [],
      command: "make deploy",
      appendable: true,
    });
  }
}

describe("commands through the runtime", () => {
  test("/memory review lists a gotcha that fires often", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_save", gotcha, SESSION);
    await deployInSessions(fx, 10);

    const review = await fx.host.callTool("memory_command", { args: "review" }, SESSION);

    expect(review).toContain(
      `Gotchas that fire often:\n- [${FIRST_ID}] gotcha · repo:github.com/acme/api · Deploys need the VPN (2026-03-01)`,
    );
  });

  test("/memory move moves a memory to another scope of the session", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_save", fact, SESSION);

    const reply = await fx.host.callTool(
      "memory_command",
      { args: `move ${FIRST_ID} user` },
      SESSION,
    );

    expect(reply).toBe(`Moved [${FIRST_ID}] fact · user · Staging resets nightly (2026-03-01)`);
    expect(existsSync(join(fx.dataDir, "user", "fact", `${FIRST_ID}.md`))).toBe(true);
  });

  test("/memory org merge records the alias in the runtime's org registry", async () => {
    const fx = runtime();
    const registryFile = join(fx.dataDir, "registry.json");
    const orgs = {
      "github.com/acme": { owner: "acme" },
      "github.com/acme-labs": { owner: "acme-labs" },
    };
    writeFileSync(registryFile, JSON.stringify({ orgs }));

    const reply = await fx.host.callTool(
      "memory_command",
      { args: "org merge github.com/acme github.com/acme-labs" },
      SESSION,
    );

    expect(reply).toStartWith("Merged org github.com/acme-labs into github.com/acme");
    expect(JSON.parse(readFileSync(registryFile, "utf8"))).toMatchObject({
      aliases: { "github.com/acme-labs": "github.com/acme" },
    });
  });
});

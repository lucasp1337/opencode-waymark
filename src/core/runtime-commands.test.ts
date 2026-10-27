import { describe, expect, test } from "bun:test";
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
      `[${FIRST_ID}] fact · repo:github.com/acme/api · Staging resets nightly`,
    );
  });

  test("/memory review lists a fact that left the session index", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_save", fact, SESSION);
    await idleSessions(fx);

    const review = await fx.host.callTool("memory_command", { args: "review" }, SESSION);

    expect(review).toContain(
      `Left the session index, still searchable:\n- [${FIRST_ID}] fact · repo:github.com/acme/api · Staging resets nightly`,
    );
  });

  test("/memory review lists nothing for a fact still in the index", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_save", fact, SESSION);

    const review = await fx.host.callTool("memory_command", { args: "review" }, SESSION);

    expect(review).toStartWith("Nothing needs review");
  });
});

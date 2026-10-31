import { describe, expect, test } from "bun:test";
import {
  FIRST_ID as ID,
  type RuntimeFixture,
  SESSION,
  useRuntime,
} from "../../../../test/runtime-fixture";

const runtime = useRuntime();

async function withRule(): Promise<RuntimeFixture> {
  const fx = runtime();
  await fx.host.callTool(
    "memory_save",
    { kind: "rule", scope: "repo", title: "Use UTC", body: "Timestamps in UTC.", why: "logs" },
    SESSION,
  );
  fx.clock.advance(5_000);
  return fx;
}

function update(fx: RuntimeFixture, input: object): Promise<string> {
  return fx.host.callTool("memory_update", input, SESSION);
}

function read(fx: RuntimeFixture): Promise<string> {
  return fx.host.callTool("memory_read", { id: ID }, SESSION);
}

describe("memory_update", () => {
  test("changes only the given fields and bumps updated", async () => {
    const fx = await withRule();

    const reply = await update(fx, { id: ID, body: "All timestamps in UTC." });

    expect(reply).toBe(`Updated [${ID}] rule · repo:github.com/acme/api · Use UTC (2026-03-01)`);
    const text = await read(fx);
    expect(text).toContain("why: logs");
    expect(text).toContain("updated: 2026-03-01T10:00:05.000Z");
    expect(text).toEndWith("All timestamps in UTC.");
  });

  test("adds howToApply to a rule", async () => {
    const fx = await withRule();

    await update(fx, { id: ID, howToApply: "In log code" });

    expect(await read(fx)).toContain("howToApply: In log code");
  });

  test("refuses howToApply on a fact", async () => {
    const fx = runtime();
    await fx.host.callTool(
      "memory_save",
      { kind: "fact", scope: "repo", title: "Staging resets", body: "b" },
      SESSION,
    );

    const reply = await update(fx, { id: ID, howToApply: "In log code" });

    expect(reply).toBe("Not updated: fact cannot have howToApply (only rule, preference, gotcha)");
  });

  test("toasts the updated kind and scope", async () => {
    const fx = await withRule();

    await update(fx, { id: ID, title: "Use UTC everywhere" });

    expect(fx.host.toasts).toContain("waymark · updated rule · repo:github.com/acme/api");
  });

  test("refuses an unknown id", async () => {
    const fx = await withRule();

    expect(await update(fx, { id: "01JB8Z6Q4R3M2N1P0V9W8X9999", body: "x" })).toBe(
      "Not updated: no memory with id 01JB8Z6Q4R3M2N1P0V9W8X9999",
    );
  });

  test("refuses invalid fields and leaves the memory unchanged", async () => {
    const fx = await withRule();

    const reply = await update(fx, { id: ID, title: "", triggers: { tool: ["x"] } });

    expect(reply).toBe(
      "Not updated: title must be a non-empty string; triggers.tool is not one of paths, commands, tools, keywords",
    );
    expect(await read(fx)).toContain("title: Use UTC\n");
  });

  test("refuses a change that grows a rule past the scope budget", async () => {
    const fx = await withRule();

    const reply = await update(fx, { id: ID, body: "x".repeat(4000) });

    expect(reply).toStartWith(
      "Not updated: rule and preference memories in repo:github.com/acme/api are capped",
    );
  });
});

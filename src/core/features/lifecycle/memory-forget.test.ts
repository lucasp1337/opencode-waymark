import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  FIRST_ID as ID,
  type RuntimeFixture,
  SESSION,
  useRuntime,
} from "../../../../test/runtime-fixture";

const runtime = useRuntime();

async function withFact(): Promise<RuntimeFixture> {
  const fx = runtime();
  await fx.host.callTool(
    "memory_save",
    { kind: "fact", scope: "user", title: "Staging resets nightly", body: "At 02:00." },
    SESSION,
  );
  return fx;
}

describe("memory_forget", () => {
  test("deletes the file and the memory can no longer be read", async () => {
    const fx = await withFact();

    const reply = await fx.host.callTool("memory_forget", { id: ID }, SESSION);

    expect(reply).toBe(`Forgot [${ID}] fact · user · Staging resets nightly (2026-03-01)`);
    expect(existsSync(join(fx.dataDir, "user", "fact", `${ID}.md`))).toBe(false);
    expect(await fx.host.callTool("memory_read", { id: ID }, SESSION)).toBe(
      `no memory with id ${ID}`,
    );
  });

  test("toasts the kind, scope and title of the forgotten memory", async () => {
    const fx = await withFact();

    await fx.host.callTool("memory_forget", { id: ID }, SESSION);

    expect(fx.host.toasts).toContain("waymark · forgot fact · user · Staging resets nightly");
  });

  test("refuses an unknown id", async () => {
    const fx = await withFact();

    expect(
      await fx.host.callTool("memory_forget", { id: "01JB8Z6Q4R3M2N1P0V9W8X9999" }, SESSION),
    ).toBe("Not forgotten: no memory with id 01JB8Z6Q4R3M2N1P0V9W8X9999");
  });
});

import { describe, expect, test } from "bun:test";
import {
  API_REPO,
  idNumber,
  SEEDED_AT,
  useCommandFixture,
} from "../../../../test/commands-fixture";
import { validContent } from "../../../../test/valid-content";
import { newMemory } from "../../model/memory";
import { decodeMemory, encodeMemory } from "../../store/codec";

const fixture = useCommandFixture();

function legacyReference() {
  const complete = newMemory(
    validContent({ kind: "reference", title: "Runbook", body: "x", locator: "PAY-1" }),
    { id: idNumber(1), scope: API_REPO, now: SEEDED_AT },
  );
  const decoded = decodeMemory(encodeMemory(complete).replace("locator: PAY-1\n", ""));
  if (!decoded.ok) {
    throw new Error(decoded.error);
  }
  return decoded.value;
}

describe("memory_command review of incomplete memories", () => {
  test("lists a reference saved before locators existed and what it lacks", async () => {
    const fx = fixture();
    fx.store.save(legacyReference());

    const report = await fx.run("review");

    expect(report).toContain(
      `Missing a required field, fix with memory_update:\n- [${idNumber(1)}] reference · repo:github.com/acme/api · Runbook (2026-03-01) (missing locator)`,
    );
  });

  test("does not list a reference that has its locator", async () => {
    const fx = fixture();
    fx.seed({
      n: 1,
      scope: API_REPO,
      content: { kind: "reference", title: "Runbook", body: "x", locator: "PAY-1" },
    });

    expect(await fx.run("review")).toStartWith("Nothing needs review");
  });
});

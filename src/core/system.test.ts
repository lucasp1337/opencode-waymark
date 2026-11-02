import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isMemoryId } from "./model/id";
import { systemDeps } from "./system";

describe("systemDeps", () => {
  test("keeps data under XDG_DATA_HOME/waymark", () => {
    expect(systemDeps({ XDG_DATA_HOME: "/data" }).dataDir).toBe("/data/waymark");
  });

  test("finds the skills Waymark ships", () => {
    const skill = join(systemDeps({}).skillsDir, "waymark-save", "SKILL.md");

    expect(existsSync(skill)).toBe(true);
  });

  test("hands out valid ids that sort in creation order", () => {
    const { newId } = systemDeps({});

    const ids = [newId(), newId(), newId()];

    expect(ids.every(isMemoryId)).toBe(true);
    expect(ids.toSorted()).toEqual(ids);
    expect(new Set(ids).size).toBe(3);
  });

  test("refuses an id source that produces something that is not an id", () => {
    const { newId } = systemDeps({}, () => "not-an-id");

    expect(() => newId()).toThrow("ulid produced an invalid id: not-an-id");
  });
});

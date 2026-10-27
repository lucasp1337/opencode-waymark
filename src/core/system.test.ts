import { describe, expect, test } from "bun:test";
import { isMemoryId } from "./model/id";
import { systemDeps } from "./system";

describe("systemDeps", () => {
  test("keeps data under XDG_DATA_HOME/waymark", () => {
    expect(systemDeps({ XDG_DATA_HOME: "/data" }).dataDir).toBe("/data/waymark");
  });

  test("hands out valid ids that sort in creation order", () => {
    const { newId } = systemDeps({});

    const ids = [newId(), newId(), newId()];

    expect(ids.every(isMemoryId)).toBe(true);
    expect(ids.toSorted()).toEqual(ids);
    expect(new Set(ids).size).toBe(3);
  });
});

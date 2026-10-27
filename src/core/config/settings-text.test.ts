import { describe, expect, test } from "bun:test";
import { settingsFrom } from "./settings";
import { describeSettings, presetLabel, presetSummary } from "./settings-text";

describe("presetLabel", () => {
  test("capitalizes the preset name", () => {
    expect(presetLabel("balanced")).toBe("Balanced");
  });
});

describe("presetSummary", () => {
  test("gives the caps per scope and the index size", () => {
    expect(presetSummary("lean")).toBe(
      "Lean: caps in tokens user 200, org 300, product 150, repo 300; 20 index lines",
    );
  });
});

describe("describeSettings", () => {
  test("writes one line per setting", () => {
    expect(describeSettings(settingsFrom({}))).toEqual([
      "preset: balanced",
      "caps in tokens: user 400, org 600, product 300, repo 600",
      "index lines: 40",
      "index exit: 20 sessions and 30 days without a read",
      "subagents: none",
      "compaction save: on",
      "toasts: on",
    ]);
  });

  test("lists subagents and shows switched-off flags", () => {
    const lines = describeSettings(
      settingsFrom({ subagents: ["review", "build"], compactionSave: false, toasts: false }),
    );

    expect(lines).toContain("subagents: review, build");
    expect(lines).toContain("compaction save: off");
    expect(lines).toContain("toasts: off");
  });
});

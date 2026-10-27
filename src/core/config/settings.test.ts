import { describe, expect, test } from "bun:test";
import { PRESETS } from "../features/recall/presets";
import { type ConfigFile, mergeConfig, settingsFrom } from "./settings";

describe("settingsFrom", () => {
  test("an empty config gives the Balanced defaults", () => {
    expect(settingsFrom({})).toEqual({
      preset: "balanced",
      caps: { user: 400, org: 600, product: 300, repo: 600 },
      indexLines: 40,
      indexExit: { sessions: 20, days: 30 },
      subagents: [],
      compactionSave: true,
      toasts: true,
    });
  });

  test("a preset supplies its caps and index size", () => {
    const settings = settingsFrom({ preset: "rich" });

    expect(settings.preset).toBe("rich");
    expect(settings.caps).toEqual(PRESETS.rich.caps);
    expect(settings.indexLines).toBe(PRESETS.rich.indexLines);
  });

  test("explicit caps and indexLines override the preset", () => {
    const settings = settingsFrom({ preset: "lean", caps: { repo: 900 }, indexLines: 10 });

    expect(settings.caps).toEqual({ ...PRESETS.lean.caps, repo: 900 });
    expect(settings.indexLines).toBe(10);
  });

  test("a partial index exit keeps the default for the other threshold", () => {
    expect(settingsFrom({ indexExit: { days: 7 } }).indexExit).toEqual({ sessions: 20, days: 7 });
  });

  test("the other fields are taken as given", () => {
    const settings = settingsFrom({ subagents: ["review"], compactionSave: false, toasts: false });

    expect(settings.subagents).toEqual(["review"]);
    expect(settings.compactionSave).toBe(false);
    expect(settings.toasts).toBe(false);
  });
});

describe("mergeConfig", () => {
  test("patched fields replace the file's", () => {
    const merged = mergeConfig({ indexLines: 30, toasts: true }, { toasts: false });

    expect(merged).toEqual({ indexLines: 30, toasts: false });
  });

  test("caps and index exit merge entry by entry", () => {
    const base: ConfigFile = { caps: { user: 100, repo: 200 }, indexExit: { days: 5 } };

    const merged = mergeConfig(base, { caps: { repo: 900 }, indexExit: { sessions: 3 } });

    expect(merged).toEqual({
      caps: { user: 100, repo: 900 },
      indexExit: { days: 5, sessions: 3 },
    });
  });

  test("keeps caps and index size when the patch names no preset", () => {
    const merged = mergeConfig({ preset: "lean", caps: { repo: 900 }, indexLines: 10 }, {});

    expect(merged).toEqual({ preset: "lean", caps: { repo: 900 }, indexLines: 10 });
  });

  test("a new preset drops earlier caps and index size", () => {
    const base: ConfigFile = { preset: "lean", caps: { repo: 900 }, indexLines: 10, toasts: false };

    const merged = mergeConfig(base, { preset: "rich" });

    expect(merged).toEqual({ preset: "rich", toasts: false });
  });

  test("naming the preset already in effect keeps caps and index size", () => {
    const base: ConfigFile = { preset: "lean", caps: { repo: 900 }, indexLines: 10 };

    expect(mergeConfig(base, { preset: "lean" })).toEqual(base);
  });

  test("naming the default preset keeps overrides when the file names no preset", () => {
    const base: ConfigFile = { caps: { repo: 900 }, indexLines: 10 };

    expect(mergeConfig(base, { preset: "balanced" })).toEqual({ ...base, preset: "balanced" });
  });

  test("a new preset keeps the caps given with it", () => {
    const merged = mergeConfig({ caps: { repo: 900 } }, { preset: "rich", caps: { user: 50 } });

    expect(merged).toEqual({ preset: "rich", caps: { user: 50 } });
  });
});

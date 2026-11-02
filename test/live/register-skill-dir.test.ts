import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { at, type Json, liveEnvWithProbe, liveEnvWithWaymark, parseJson } from "./harness";

const SKILLS_DIR = resolve(import.meta.dir, "..", "fixtures", "skills");

const REPO_SKILLS_DIR = resolve(import.meta.dir, "..", "..", "skills");

function entryNamed(list: Json, name: string): Json | undefined {
  return Array.isArray(list) ? list.find((entry) => at(entry, "name") === name) : undefined;
}

describe("registerSkillDir", () => {
  test("a skill in a registered dir is listed by opencode with its description and body", async () => {
    const server = await liveEnvWithProbe().serve();
    try {
      await server.newSession();
      const response = await server.api("/skill");
      const entry = entryNamed(parseJson(await response.text()), "waymark-probe");

      expect(at(entry, "description")).toBe("Waymark probe skill");
      expect(at(entry, "location")).toBe(resolve(SKILLS_DIR, "waymark-probe", "SKILL.md"));
      expect(String(at(entry, "content"))).toContain("WAYMARK_SKILL_BODY_8H3");
    } finally {
      await server.stop();
    }
  });

  test("Waymark's own skills dir is registered by its activation and lists waymark-save", async () => {
    const server = await liveEnvWithWaymark().serve();
    try {
      await server.newSession();
      const response = await server.api("/skill");
      const entry = entryNamed(parseJson(await response.text()), "waymark-save");

      expect(String(at(entry, "description"))).toContain("Load before saving or updating");
      expect(at(entry, "location")).toBe(resolve(REPO_SKILLS_DIR, "waymark-save", "SKILL.md"));
    } finally {
      await server.stop();
    }
  });
});

import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeHost } from "../../../../test/fake-host";
import { useTempDirs } from "../../../../test/temp-dir";
import type { Capabilities } from "../../port";
import { nodeFileSystem } from "../../store/fs";
import { SAVE_SKILL_POINTER } from "./instructions";
import { saveGuidance, skillBody } from "./save-guidance";

const tempDir = useTempDirs();

const SKILL =
  "---\nname: waymark-save\ndescription: When to load.\n---\n\n# Saving\n\nThe policy.\n\n## Part\n\nMore.\n";

function capabilities(skills: boolean): Capabilities {
  return {
    systemInjection: true,
    toolOutputMutation: true,
    compactionHook: true,
    toast: true,
    skills,
  };
}

function skillsDirWith(content: string | undefined): string {
  const dir = tempDir();
  if (content !== undefined) {
    mkdirSync(join(dir, "waymark-save"));
    writeFileSync(join(dir, "waymark-save", "SKILL.md"), content);
  }
  return dir;
}

function guidance(skills: boolean, skillsDir: string) {
  const host = createFakeHost(capabilities(skills));
  return { host, text: saveGuidance({ host, fs: nodeFileSystem, skillsDir }) };
}

describe("skillBody", () => {
  test("drops the frontmatter and the top-level heading, keeps the rest", () => {
    expect(skillBody(SKILL)).toEqual({ ok: true, value: "The policy.\n\n## Part\n\nMore." });
  });

  test("keeps a body that has no top-level heading", () => {
    expect(skillBody("---\nname: x\n---\nJust text.\n")).toEqual({ ok: true, value: "Just text." });
  });

  test("refuses a file without frontmatter", () => {
    expect(skillBody("# Saving\n\nText.\n")).toEqual({ ok: false, error: "no frontmatter" });
  });

  test("refuses a file with nothing after the frontmatter and heading", () => {
    expect(skillBody("---\nname: x\n---\n# Saving\n")).toEqual({ ok: false, error: "no body" });
  });
});

describe("saveGuidance", () => {
  test("points at the skill when the host has skills, without reading the file", () => {
    const { text, host } = guidance(true, skillsDirWith(undefined));

    expect(text).toBe(SAVE_SKILL_POINTER);
    expect(host.logs).toEqual([]);
  });

  test("inlines the skill body when the host has no skills", () => {
    const { text } = guidance(false, skillsDirWith(SKILL));

    expect(text).toBe("The policy.\n\n## Part\n\nMore.");
  });

  test("is empty and logged when the skill file is missing", () => {
    const { text, host } = guidance(false, skillsDirWith(undefined));

    expect(text).toBe("");
    expect(host.logs).toHaveLength(1);
    expect(host.logs[0]).toMatchObject({
      level: "error",
      data: { error: "file not found" },
    });
  });

  test("is empty and logged when the skill file cannot be read", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "waymark-save", "SKILL.md"), { recursive: true });

    const { text, host } = guidance(false, dir);

    expect(text).toBe("");
    expect(host.logs).toHaveLength(1);
  });

  test("is empty and logged when the skill file has no frontmatter", () => {
    const { text, host } = guidance(false, skillsDirWith("# Saving\n\nText.\n"));

    expect(text).toBe("");
    expect(host.logs[0]).toMatchObject({ data: { error: "no frontmatter" } });
  });
});

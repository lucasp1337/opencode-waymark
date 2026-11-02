import { join } from "node:path";
import { err, ok, type Result } from "../../model/result";
import type { HostPort } from "../../port";
import type { FileSystem } from "../../store/fs";
import { SAVE_SKILL } from "../save-skill";
import { SAVE_SKILL_POINTER } from "./instructions";

const FRONTMATTER = /^---\n[\s\S]*?\n---\n/;
const TOP_HEADING = /^# .*\n/;

// What follows the frontmatter and the top-level heading, which a skill-less host has no use for.
export function skillBody(skillFile: string): Result<string, string> {
  const frontmatter = FRONTMATTER.exec(skillFile);
  if (frontmatter === null) {
    return err("no frontmatter");
  }
  const body = skillFile.slice(frontmatter[0].length).trimStart().replace(TOP_HEADING, "").trim();
  return body === "" ? err("no body") : ok(body);
}

function readSkill(fs: FileSystem, file: string): Result<string, string> {
  try {
    const text = fs.readText(file);
    return text === undefined ? err("file not found") : skillBody(text);
  } catch (error) {
    return err(String(error));
  }
}

interface SaveGuidanceDeps {
  readonly host: Pick<HostPort, "capabilities" | "log">;
  readonly fs: FileSystem;
  readonly skillsDir: string;
}

// With skills the agent is pointed at the skill; without, the skill's own text is inlined, so
// the guidance lives in one file. Empty when that file cannot be used.
export function saveGuidance({ host, fs, skillsDir }: SaveGuidanceDeps): string {
  if (host.capabilities.skills) {
    return SAVE_SKILL_POINTER;
  }
  const file = join(skillsDir, SAVE_SKILL, "SKILL.md");
  const body = readSkill(fs, file);
  if (!body.ok) {
    host.log("error", "save guidance unavailable; instructions carry the triggers only", {
      file,
      error: body.error,
    });
    return "";
  }
  return body.value;
}

import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { SESSION, useRuntime } from "../../test/runtime-fixture";
import { useTempDirs } from "../../test/temp-dir";
import type { Capabilities } from "./port";

const tempDir = useTempDirs();

const WITHOUT_SKILLS: Capabilities = {
  systemInjection: true,
  toolOutputMutation: true,
  compactionHook: true,
  toast: true,
  skills: false,
};

const withSkills = useRuntime({ skillsDir: "/skills" });
const withoutSkills = useRuntime({ capabilities: WITHOUT_SKILLS });
const withBrokenSkills = useRuntime(() => ({
  capabilities: WITHOUT_SKILLS,
  skillsDir: tempDir(),
}));

describe("skills", () => {
  test("registers the skills directory when the host supports skills", () => {
    expect(withSkills().host.skillDirs).toEqual(["/skills"]);
  });

  test("registers nothing when the host has no skills", () => {
    expect(withoutSkills().host.skillDirs).toEqual([]);
  });

  test("the session instructions point at the save skill when the host supports skills", async () => {
    const [block] = await withSkills().host.emitSystem(SESSION);

    expect(block).toContain("load the `waymark-save` skill");
  });

  test("the session instructions carry the save skill's text when the host has no skills", async () => {
    const [block] = await withoutSkills().host.emitSystem(SESSION);

    expect(block).toContain("## Check before saving, in this order");
    expect(block).not.toContain("name: waymark-save");
    expect(block).not.toContain("# Saving a Waymark memory");
    expect(block).not.toContain("load the `waymark-save` skill");
  });

  test("the instructions are the short form, and the failure is logged, when the skill file is missing", async () => {
    const fx = withBrokenSkills();
    mkdirSync(join(fx.setup.skillsDir, "waymark-save"));

    const [block = ""] = await fx.host.emitSystem(SESSION);

    expect(block).toContain("Never copy a secret");
    expect(block).not.toContain("waymark-save");
    expect(fx.host.logs.some((entry) => entry.msg.includes("save guidance unavailable"))).toBe(
      true,
    );
  });

  test("memory_save mentions the skill only when the host supports skills", () => {
    const described = (fx: ReturnType<typeof withSkills>) =>
      fx.host.tools.get("memory_save")?.description;

    expect(described(withSkills())).toContain("Load the waymark-save skill first.");
    expect(described(withoutSkills())).not.toContain("waymark-save");
  });
});

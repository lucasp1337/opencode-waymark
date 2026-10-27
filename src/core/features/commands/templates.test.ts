import { describe, expect, test } from "bun:test";
import { useCommandFixture } from "../../../../test/commands-fixture";
import { useRuntime } from "../../../../test/runtime-fixture";
import { SETUP_INSTRUCTIONS } from "../setup/setup-command";
import { type CommandTemplate, commandTemplates } from "./templates";

const SETUP = "SETUP TEXT: ask the user which preset they want.";

const runtime = useRuntime();
const commands = useCommandFixture();

function templateOf(name: string): CommandTemplate {
  const found = commandTemplates(SETUP).find((command) => command.name === name);
  if (found === undefined) {
    throw new Error(`no ${name} command`);
  }
  return found;
}

describe("commandTemplates", () => {
  test("defines memory, remember and forget", () => {
    expect(commandTemplates(SETUP).map((command) => command.name)).toEqual([
      "memory",
      "remember",
      "forget",
    ]);
  });

  test("every description is one short line", () => {
    for (const { description } of commandTemplates(SETUP)) {
      expect(description).not.toBe("");
      expect(description).not.toContain("\n");
      expect(description.length).toBeLessThan(80);
    }
  });

  test("every template passes the user's arguments through exactly once", () => {
    for (const { template } of commandTemplates(SETUP)) {
      expect(template.split("$ARGUMENTS")).toHaveLength(2);
    }
  });

  test("no template, with the real setup instructions, uses syntax that opencode expands besides the arguments", () => {
    for (const { template } of commandTemplates(SETUP_INSTRUCTIONS)) {
      expect(template).not.toMatch(/\$\d/);
      expect(template).not.toContain("!`");
      expect(template).not.toContain("@");
    }
  });

  test("the memory command tells the agent to follow the setup text when the first word is setup", () => {
    const { template } = templateOf("memory");

    expect(template).toStartWith("Waymark memory command. Arguments: $ARGUMENTS");
    expect(template).toContain('If the first word of the arguments is "setup"');
    expect(template).toContain(SETUP);
  });

  test("the memory command otherwise passes the arguments to memory_command and shows its result", () => {
    const { template } = templateOf("memory");

    expect(template).toContain(
      "call memory_command once, with args set to exactly the arguments above",
    );
    expect(template).toContain("show its result to the user");
    expect(template).toContain('After "review", go through the listed memories with the user');
  });

  test("remember saves with memory_save and handles the related-memories reply", () => {
    const { template } = templateOf("remember");

    expect(template).toContain("call memory_save");
    expect(template).toContain("a rule needs a why, a gotcha needs triggers");
    expect(template).toContain("If memory_save replies with related memories, follow its reply");
  });

  test("forget deletes by id with memory_forget, or searches first with memory_search", () => {
    const { template } = templateOf("forget");

    expect(template).toContain("call memory_forget with it");
    expect(template).toContain("call memory_search");
    expect(template).toContain("ask which of them to forget");
  });

  test("every tool a template names is a tool Waymark registers", () => {
    const registered = new Set([...runtime().host.tools.keys(), ...commands().host.tools.keys()]);

    for (const { template } of commandTemplates(SETUP)) {
      for (const tool of template.match(/memory_[a-z]+/g) ?? []) {
        expect(registered.has(tool)).toBe(true);
      }
    }
  });
});

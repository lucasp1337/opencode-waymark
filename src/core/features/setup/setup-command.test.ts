import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { useTempDirs } from "../../../../test/temp-dir";
import { openConfigStore } from "../../config/config-store";
import { PRESET_NAMES } from "../../config/preset-name";
import { SCOPE_LEVELS } from "../../model/scope";
import { nodeFileSystem } from "../../store/fs";
import { memoryConfigTool } from "./memory-config";
import { SETUP_INSTRUCTIONS } from "./setup-command";

const tempDir = useTempDirs();

function between(start: string, end: string): string {
  const from = SETUP_INSTRUCTIONS.indexOf(start);
  return SETUP_INSTRUCTIONS.slice(from, SETUP_INSTRUCTIONS.indexOf(end, from));
}

const QUICK = between("Quick:", "Advanced:");
const ADVANCED_LIST = between("Advanced:", "Then call memory_config once");

function memoryConfigSettings(): string[] {
  const config = openConfigStore(nodeFileSystem, join(tempDir(), "config.jsonc"), () => undefined);
  return Object.keys(memoryConfigTool({ config }).inputSchema.properties);
}

describe("SETUP_INSTRUCTIONS", () => {
  test("asks the user to choose between Quick and Advanced", () => {
    expect(SETUP_INSTRUCTIONS).toContain("Ask whether they want Quick or Advanced.");
  });

  test("Quick offers each preset with its caps and marks the default", () => {
    expect(QUICK).toContain(
      "- Lean: caps in tokens user 200, org 300, product 150, repo 300; 20 index lines\n",
    );
    expect(QUICK).toContain(
      "- Balanced: caps in tokens user 400, org 600, product 300, repo 600; 40 index lines (default)\n",
    );
    expect(QUICK).toContain(
      "- Rich: caps in tokens user 800, org 1200, product 600, repo 1200; 80 index lines\n",
    );
  });

  test("Quick passes the choice on as the preset setting", () => {
    expect(QUICK).toContain(
      `memory_config with preset set to their choice (${PRESET_NAMES.join(", ")})`,
    );
  });

  test("Advanced asks about every other memory_config setting", () => {
    for (const setting of memoryConfigSettings().filter((name) => name !== "preset")) {
      expect(ADVANCED_LIST).toContain(`(${setting})`);
    }
  });

  test("Advanced names the scopes whose caps can be set", () => {
    expect(ADVANCED_LIST).toContain(`${SCOPE_LEVELS.join(", ")} (caps)`);
  });

  test("ends with one memory_config call and showing its reply", () => {
    expect(SETUP_INSTRUCTIONS).toEndWith(
      "Then call memory_config once with only the settings the user changed, and show them its reply.",
    );
  });

  test("has nothing opencode would expand in a command template", () => {
    expect(SETUP_INSTRUCTIONS).not.toMatch(/\$\d/);
    expect(SETUP_INSTRUCTIONS).not.toContain("!`");
    expect(SETUP_INSTRUCTIONS).not.toContain("@");
  });
});

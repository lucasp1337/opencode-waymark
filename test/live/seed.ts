import { join } from "node:path";
import { type MemoryContent, newMemory } from "../../src/core/model/memory";
import type { ScopeRef } from "../../src/core/model/scope";
import { nodeFileSystem } from "../../src/core/store/fs";
import { createMemoryFiles } from "../../src/core/store/memory-files";
import { memoryId } from "../memory-id";
import { validContent } from "../valid-content";
import type { LiveEnv } from "./harness";

// Writes a memory file into the sandbox's Waymark data dir, as an earlier session would have.
export function seedMemory(
  env: LiveEnv,
  id: string,
  content: MemoryContent,
  scope: ScopeRef = { level: "user" },
): string {
  return createMemoryFiles(join(env.dataHome, "waymark"), nodeFileSystem).write(
    newMemory(validContent(content), {
      id: memoryId(id),
      scope,
      now: new Date("2026-03-01T10:00:00.000Z"),
    }),
  );
}

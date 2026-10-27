import { homedir } from "node:os";
import { monotonicFactory } from "ulid";
import { isMemoryId, type MemoryId } from "./model/id";
import type { RuntimeDeps } from "./runtime";
import { processGit } from "./scope/git";
import { nodeFileSystem } from "./store/fs";
import { dataRoot } from "./store/layout";

// The real clock, file system, git and id source; tests inject their own.
export function systemDeps(env: Record<string, string | undefined>): Omit<RuntimeDeps, "options"> {
  const nextUlid = monotonicFactory();
  const now = () => new Date();
  const newId = (): MemoryId => {
    const id = nextUlid(now().getTime());
    if (!isMemoryId(id)) {
      throw new Error(`ulid produced an invalid id: ${id}`);
    }
    return id;
  };
  return { dataDir: dataRoot(env, homedir()), fs: nodeFileSystem, git: processGit, now, newId };
}

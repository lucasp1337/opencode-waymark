import { homedir } from "node:os";
import { join } from "node:path";
import { monotonicFactory } from "ulid";
import { loadTransformersEmbedder } from "./features/recall/embeddings/transformers-embedder";
import { isMemoryId, type MemoryId } from "./model/id";
import type { RuntimeDeps } from "./runtime";
import { processGit, processOriginUrl } from "./scope/git";
import { nodeFileSystem } from "./store/fs";
import { dataRoot } from "./store/layout";

// The real clock, file system, git and id source; tests inject their own.
export function systemDeps(
  env: Record<string, string | undefined>,
  nextUlid: (seedTime: number) => string = monotonicFactory(),
): Omit<RuntimeDeps, "options"> {
  const now = () => new Date();
  const newId = (): MemoryId => {
    const id = nextUlid(now().getTime());
    if (!isMemoryId(id)) {
      throw new Error(`ulid produced an invalid id: ${id}`);
    }
    return id;
  };
  const dataDir = dataRoot(env, homedir());
  return {
    dataDir,
    fs: nodeFileSystem,
    git: processGit,
    originUrl: processOriginUrl,
    now,
    newId,
    loadEmbedder: () => loadTransformersEmbedder(join(dataDir, "models")),
  };
}

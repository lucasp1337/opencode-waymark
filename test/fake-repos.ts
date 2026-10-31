import type { AsyncOriginUrl, GitAnswer } from "../src/core/scope/git";
import { type FileSystem, nodeFileSystem } from "../src/core/store/fs";

interface FakeReposOptions {
  // Roots whose origin lookup fails.
  readonly broken?: readonly string[];
  // When set, every answer waits until its release function is called.
  readonly held?: Array<() => void>;
  // Every origin lookup rejects.
  readonly rejecting?: boolean;
}

// Repositories are the roots in `origins`; their `.git` exists as far as the file system tells.
export function fakeRepos(origins: ReadonlyMap<string, string>, options: FakeReposOptions = {}) {
  const originAsks: string[] = [];
  const fs: FileSystem = {
    ...nodeFileSystem,
    mtimeMs: (path) =>
      [...origins.keys()].some((root) => path === `${root}/.git`)
        ? 1
        : nodeFileSystem.mtimeMs(path),
  };
  const answer = (root: string): GitAnswer => {
    const origin = origins.get(root);
    if (options.broken?.includes(root)) {
      return { status: "failed", reason: "git did not answer" };
    }
    return origin === undefined ? { status: "absent" } : { status: "found", value: origin };
  };
  const originUrl: AsyncOriginUrl = (root) => {
    originAsks.push(root);
    if (options.rejecting === true) {
      return Promise.reject(new Error("spawn failed"));
    }
    const { held } = options;
    return held === undefined
      ? Promise.resolve(answer(root))
      : new Promise((release) => held.push(() => release(answer(root))));
  };
  return { fs, originAsks, originUrl };
}

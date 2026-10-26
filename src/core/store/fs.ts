import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

// The file operations Waymark needs, injected so tests can observe or break them.
export interface FileSystem {
  // undefined when the file does not exist; other errors throw.
  readText(path: string): string | undefined;
  // Writes `<path>.tmp`, fsyncs it, then renames over `path`, creating parent dirs.
  writeAtomic(path: string, text: string): void;
  remove(path: string): void;
  // Every file below `dir`, recursively; empty when `dir` does not exist.
  listFiles(dir: string): string[];
  // undefined when the file does not exist.
  mtimeMs(path: string): number | undefined;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  }
}

export const nodeFileSystem: FileSystem = {
  readText(path) {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if (isMissing(error)) {
        return undefined;
      }
      throw error;
    }
  },
  writeAtomic,
  remove: (path) => rmSync(path, { force: true }),
  listFiles,
  mtimeMs: (path) => statSync(path, { throwIfNoEntry: false })?.mtimeMs,
};

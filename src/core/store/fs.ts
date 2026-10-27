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
  // Renames `from` to `to`, creating parent dirs and replacing any file already at `to`. Throws
  // when `from` does not exist.
  move(from: string, to: string): void;
  // Every file below `dir`, recursively; empty when `dir` does not exist.
  listFiles(dir: string): string[];
  // undefined when the file does not exist.
  mtimeMs(path: string): number | undefined;
  // False for a file and for a path that does not exist; other errors throw.
  isDirectory(path: string): boolean;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isMissing(error: unknown): boolean {
  return hasCode(error, "ENOENT");
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch (error) {
    // ENOTDIR: a parent in the path is a file, so nothing can exist there.
    if (isMissing(error) || hasCode(error, "ENOTDIR")) {
      return false;
    }
    throw error;
  }
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

function move(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
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
  move,
  listFiles,
  mtimeMs: (path) => statSync(path, { throwIfNoEntry: false })?.mtimeMs,
  isDirectory,
};

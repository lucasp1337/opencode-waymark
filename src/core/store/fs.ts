import {
  closeSync,
  type Dirent,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { ulid } from "ulid";

// The file operations Waymark needs, injected so tests can observe or break them.
export interface FileSystem {
  // undefined when the file does not exist; other errors throw.
  readText(path: string): string | undefined;
  // Writes `<path>.<pid>.<id>.tmp`, fsyncs it, then renames over `path`, creating parent dirs.
  // Once renamed the file is in place: a failure to sync its directories afterwards goes to
  // `onUnsynced`, or throws when there is none. A crash can leave a stray temp file; it is
  // ignored and never deleted.
  writeAtomic(path: string, text: string, onUnsynced?: (error: unknown) => void): void;
  // Creates `path` with `text` only if nothing is there yet, creating parent dirs. False when
  // the file already exists.
  createExclusive(path: string, text: string): boolean;
  remove(path: string): void;
  // Renames `from` to `to`, creating parent dirs and replacing any file already at `to`. Throws
  // when `from` does not exist.
  move(from: string, to: string): void;
  // Every file below `dir`, recursively, following symlinks; each directory is walked once
  // (by real path), so a link back up the tree or to a directory already seen adds nothing. Empty when `dir` does not exist.
  listFiles(dir: string): string[];
  // undefined when the file does not exist.
  mtimeMs(path: string): number | undefined;
  // undefined when the file does not exist.
  sizeBytes(path: string): number | undefined;
  // The path with every link resolved; undefined when it does not exist.
  realPath(path: string): string | undefined;
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

function fsyncDirectory(dir: string): void {
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// A rename or a new directory is only durable once the directory holding the entry is synced.
function fsyncDirectories(leaf: string, firstCreated: string | undefined): void {
  const top = firstCreated === undefined ? leaf : dirname(firstCreated);
  for (let dir = leaf; ; dir = dirname(dir)) {
    fsyncDirectory(dir);
    if (dir === top) {
      return;
    }
  }
}

function createExclusive(path: string, text: string): boolean {
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, text, { flag: "wx" });
    return true;
  } catch (error) {
    if (hasCode(error, "EEXIST")) {
      return false;
    }
    throw error;
  }
}

function atomicWriter(newTmpSuffix: () => string): FileSystem["writeAtomic"] {
  return (path, text, onUnsynced) => {
    const dir = dirname(path);
    const firstCreated = mkdirSync(dir, { recursive: true });
    const tmp = `${path}.${newTmpSuffix()}.tmp`;
    const fd = openSync(tmp, "w");
    try {
      writeFileSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
    try {
      fsyncDirectories(dir, firstCreated);
    } catch (error) {
      if (onUnsynced === undefined) {
        throw error;
      }
      onUnsynced(error);
    }
  };
}

function move(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
}

type EntryKind = "file" | "directory" | "other";

// A symlink counts as what it points to; a dangling one is nothing.
function kindOf(path: string, entry: Dirent): EntryKind {
  const stat = entry.isSymbolicLink() ? statSync(path, { throwIfNoEntry: false }) : entry;
  if (stat?.isFile()) {
    return "file";
  }
  return stat?.isDirectory() ? "directory" : "other";
}

function collectFiles(dir: string, walked: Set<string>, found: string[]): void {
  try {
    const real = realpathSync(dir);
    if (walked.has(real)) {
      return;
    }
    walked.add(real);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const kind = kindOf(path, entry);
      if (kind === "file") {
        found.push(path);
      } else if (kind === "directory") {
        collectFiles(path, walked, found);
      }
    }
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }
}

function listFiles(dir: string): string[] {
  const found: string[] = [];
  collectFiles(dir, new Set(), found);
  return found;
}

// `newTmpSuffix` must differ between every writer, in this process and in others, so two
// writers of one file never share a temp file.
export function createFileSystem(newTmpSuffix: () => string): FileSystem {
  return {
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
    writeAtomic: atomicWriter(newTmpSuffix),
    createExclusive,
    remove: (path) => rmSync(path, { force: true }),
    move,
    listFiles,
    mtimeMs: (path) => statSync(path, { throwIfNoEntry: false })?.mtimeMs,
    sizeBytes: (path) => statSync(path, { throwIfNoEntry: false })?.size,
    realPath: (path) => {
      try {
        return realpathSync(path);
      } catch (error) {
        if (isMissing(error)) {
          return undefined;
        }
        throw error;
      }
    },
    isDirectory,
  };
}

export const nodeFileSystem: FileSystem = createFileSystem(() => `${process.pid}.${ulid()}`);

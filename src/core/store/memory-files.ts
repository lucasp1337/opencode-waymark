import { basename, dirname, extname, sep } from "node:path";
import type { MemoryId } from "../model/id";
import type { Memory } from "../model/memory";
import { err, ok, type Result } from "../model/result";
import { decodeMemory, encodeMemory } from "./codec";
import type { FileSystem } from "./fs";
import { memoryPath, scopeRoots } from "./layout";

// The markdown files are the source of truth; everything else (cache, index) derives from them.
export interface MemoryFiles {
  // Returns the path written.
  write(memory: Memory): string;
  read(path: string): Result<Memory, string>;
  // Every file named for this id, wherever it lies: a stray copy would bring the memory back.
  removeAll(id: MemoryId): void;
  // Every memory file under the scope roots; temp files and other files are not listed.
  listPaths(): string[];
  mtimeMs(path: string): number | undefined;
}

// A file that cannot be read is a problem with that file, not a reason to abort a whole scan.
function readText(fs: FileSystem, path: string): Result<string, string> {
  try {
    const text = fs.readText(path);
    return text === undefined ? err(`no memory file at ${path}`) : ok(text);
  } catch (error) {
    return err(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Listing follows symlinks, so a listed file may lie outside the data root; deleting it would
// reach into somewhere the user never gave Waymark. The file's own link may go, its target not.
function isInsideRoot(fs: FileSystem, root: string, path: string): boolean {
  const realRoot = fs.realPath(root);
  const realDir = fs.realPath(dirname(path));
  return (
    realRoot !== undefined &&
    realDir !== undefined &&
    (realDir === realRoot || realDir.startsWith(`${realRoot}${sep}`))
  );
}

// `onUnsynced` hears a written file whose directories could not be synced; the file is in place.
export function createMemoryFiles(
  root: string,
  fs: FileSystem,
  onUnsynced?: (path: string, error: unknown) => void,
): MemoryFiles {
  const listPaths = (): string[] =>
    scopeRoots(root)
      .flatMap((dir) => fs.listFiles(dir))
      .filter((path) => extname(path) === ".md");
  return {
    write(memory) {
      const path = memoryPath(root, memory);
      fs.writeAtomic(
        path,
        encodeMemory(memory),
        onUnsynced && ((error) => onUnsynced(path, error)),
      );
      return path;
    },
    read(path) {
      const text = readText(fs, path);
      if (!text.ok) {
        return text;
      }
      const decoded = decodeMemory(text.value);
      if (!decoded.ok) {
        return err(`${path}: ${decoded.error}`);
      }
      // A moved file would be listed but never removable, since removal derives the path.
      const expected = memoryPath(root, decoded.value);
      return expected === path ? decoded : err(`${path}: belongs at ${expected}`);
    },
    removeAll(id) {
      const named = listPaths().filter((candidate) => basename(candidate) === `${id}.md`);
      for (const path of named.filter((candidate) => isInsideRoot(fs, root, candidate))) {
        fs.remove(path);
      }
    },
    listPaths,
    mtimeMs: (path) => fs.mtimeMs(path),
  };
}

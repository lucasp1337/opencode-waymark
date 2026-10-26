import { extname } from "node:path";
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
  remove(memory: Memory): void;
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

export function createMemoryFiles(root: string, fs: FileSystem): MemoryFiles {
  return {
    write(memory) {
      const path = memoryPath(root, memory);
      fs.writeAtomic(path, encodeMemory(memory));
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
    remove: (memory) => fs.remove(memoryPath(root, memory)),
    listPaths: () =>
      scopeRoots(root)
        .flatMap((dir) => fs.listFiles(dir))
        .filter((path) => extname(path) === ".md"),
    mtimeMs: (path) => fs.mtimeMs(path),
  };
}

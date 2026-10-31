import type { FileSystem } from "../store/fs";

interface Snapshot {
  readonly mtimeMs: number;
  readonly sizeBytes: number;
  readonly text: string;
}

// Every tool call asks for the chain, which reads the registry; the file is read again when its
// modification time or size changed, or when a write through this FileSystem replaced it. Another
// process rewriting the file to the same size within one timestamp tick is the accepted blind spot.
export function memoizeRegistryReads(fs: FileSystem, file: string): FileSystem {
  let snapshot: Snapshot | undefined;
  return {
    ...fs,
    readText(path) {
      if (path !== file) {
        return fs.readText(path);
      }
      const mtimeMs = fs.mtimeMs(path);
      const sizeBytes = fs.sizeBytes(path);
      if (mtimeMs === undefined || sizeBytes === undefined) {
        snapshot = undefined;
        return undefined;
      }
      if (snapshot?.mtimeMs === mtimeMs && snapshot.sizeBytes === sizeBytes) {
        return snapshot.text;
      }
      const text = fs.readText(path);
      snapshot = text === undefined ? undefined : { mtimeMs, sizeBytes, text };
      return text;
    },
    writeAtomic(path, text, onUnsynced) {
      try {
        fs.writeAtomic(path, text, onUnsynced);
      } finally {
        if (path === file) {
          snapshot = undefined;
        }
      }
    },
  };
}

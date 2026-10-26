import { afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Call once at the top of a test file; every directory it hands out is removed after each test.
export function useTempDirs(): () => string {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  return () => {
    const dir = mkdtempSync(join(tmpdir(), "waymark-test-"));
    dirs.push(dir);
    return dir;
  };
}

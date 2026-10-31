import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { memoryId } from "../../../test/memory-id";
import { useTempDirs } from "../../../test/temp-dir";
import { validContent } from "../../../test/valid-content";
import { type Memory, newMemory } from "../model/memory";
import { err, ok } from "../model/result";
import type { ScopeRef } from "../model/scope";
import { type FileSystem, nodeFileSystem } from "./fs";
import { createMemoryFiles } from "./memory-files";

const tempRoot = useTempDirs();

function memoryIn(scope: ScopeRef, id = "01JB8Z6Q4R3M2N1P0V9W8X7Y6Z", body = "x"): Memory {
  return newMemory(validContent({ kind: "fact", title: "Staging resets nightly", body }), {
    id: memoryId(id),
    scope,
    now: new Date("2026-01-02T03:04:05.000Z"),
  });
}

const USER: ScopeRef = { level: "user" };
const REPO: ScopeRef = { level: "repo", id: "github.com/acme/api" };

describe("createMemoryFiles", () => {
  test.each<[string, ScopeRef, string]>([
    ["user", USER, "user/fact/01JB8Z6Q4R3M2N1P0V9W8X7Y6Z.md"],
    [
      "org",
      { level: "org", id: "github.com/acme" },
      "orgs/github.com/acme/fact/01JB8Z6Q4R3M2N1P0V9W8X7Y6Z.md",
    ],
    [
      "product",
      { level: "product", id: "payments" },
      "products/payments/fact/01JB8Z6Q4R3M2N1P0V9W8X7Y6Z.md",
    ],
    ["repo", REPO, "repos/github.com/acme/api/fact/01JB8Z6Q4R3M2N1P0V9W8X7Y6Z.md"],
  ])("writes a %s memory to its own directory", (_level, scope, expected) => {
    const root = tempRoot();

    const path = createMemoryFiles(root, nodeFileSystem).write(memoryIn(scope));

    expect(relative(root, path)).toBe(join(...expected.split("/")));
    expect(nodeFileSystem.readText(path)).not.toBeUndefined();
  });

  test("reads back what was written", () => {
    const files = createMemoryFiles(tempRoot(), nodeFileSystem);
    const memory = memoryIn(REPO, undefined, "Wiped at 02:00.\n");

    const path = files.write(memory);

    expect(files.read(path)).toEqual(ok(memory));
  });

  test("replaces an existing memory file without leaving a temp file", () => {
    const files = createMemoryFiles(tempRoot(), nodeFileSystem);
    const path = files.write(memoryIn(USER, undefined, "first"));

    files.write(memoryIn(USER, undefined, "second"));

    expect(files.read(path)).toEqual(ok(memoryIn(USER, undefined, "second")));
    expect(readdirSync(dirname(path))).toEqual(["01JB8Z6Q4R3M2N1P0V9W8X7Y6Z.md"]);
  });

  test("reports a missing file as an error", () => {
    const path = join(tempRoot(), "user", "fact", "nope.md");

    expect(createMemoryFiles(tempRoot(), nodeFileSystem).read(path)).toEqual(
      err(`no memory file at ${path}`),
    );
  });

  test("reports an undecodable file with its path", () => {
    const root = tempRoot();
    const path = join(root, "user", "fact", "broken.md");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "no frontmatter here");

    expect(createMemoryFiles(root, nodeFileSystem).read(path)).toEqual(
      err(`${path}: missing opening --- line`),
    );
  });

  test("reports a file that was moved away from where its scope and kind put it", () => {
    const root = tempRoot();
    const files = createMemoryFiles(root, nodeFileSystem);
    const original = files.write(memoryIn(USER));
    const moved = join(root, "user", "fact", "renamed.md");
    renameSync(original, moved);

    expect(files.read(moved)).toEqual(err(`${moved}: belongs at ${original}`));
  });

  test("reports a file that cannot be read instead of throwing", () => {
    const unreadable: FileSystem = {
      ...nodeFileSystem,
      readText: () => {
        throw new Error("EACCES: permission denied");
      },
    };

    expect(createMemoryFiles(tempRoot(), unreadable).read("/data/user/fact/m.md")).toEqual(
      err("/data/user/fact/m.md: EACCES: permission denied"),
    );
  });

  test("lists memory files in every scope and ignores temp and unrelated files", () => {
    const root = tempRoot();
    const files = createMemoryFiles(root, nodeFileSystem);
    const userPath = files.write(memoryIn(USER, "01JB8Z6Q4R3M2N1P0V9W8X7Y6Z"));
    const repoPath = files.write(memoryIn(REPO, "01JB8Z6Q4R3M2N1P0V9W8X7Y60"));
    writeFileSync(`${userPath}.tmp`, "half written");
    writeFileSync(join(dirname(userPath), "notes.txt"), "not a memory");
    writeFileSync(join(root, "registry.json"), "{}");
    writeFileSync(join(root, "cache.sqlite"), "");

    expect(files.listPaths().sort()).toEqual([userPath, repoPath].sort());
  });

  test("lists nothing before the first memory is written", () => {
    expect(createMemoryFiles(join(tempRoot(), "missing"), nodeFileSystem).listPaths()).toEqual([]);
  });

  test("removes only the memory it is given", () => {
    const files = createMemoryFiles(tempRoot(), nodeFileSystem);
    const gone = memoryIn(USER, "01JB8Z6Q4R3M2N1P0V9W8X7Y6Z");
    const kept = memoryIn(USER, "01JB8Z6Q4R3M2N1P0V9W8X7Y60");
    files.write(gone);
    const keptPath = files.write(kept);

    files.removeAll(gone.id);

    expect(files.listPaths()).toEqual([keptPath]);
  });

  test("never removes a file that a symlinked directory leads to outside the data root", () => {
    const root = tempRoot();
    const outside = tempRoot();
    const memory = memoryIn(USER);
    const outsideFile = join(outside, `${memory.id}.md`);
    writeFileSync(outsideFile, "not Waymark's");
    mkdirSync(join(root, "user"), { recursive: true });
    symlinkSync(outside, join(root, "user", "fact"));
    const files = createMemoryFiles(root, nodeFileSystem);
    expect(files.listPaths()).toHaveLength(1);

    files.removeAll(memory.id);

    expect(existsSync(outsideFile)).toBe(true);
  });

  test("reports a write whose directories could not be synced and still returns the path", () => {
    const unsynced: unknown[] = [];
    const syncFails: FileSystem = {
      ...nodeFileSystem,
      writeAtomic(path, text, onUnsynced) {
        nodeFileSystem.writeAtomic(path, text);
        onUnsynced?.(new Error("EIO"));
      },
    };
    const files = createMemoryFiles(tempRoot(), syncFails, (path, error) =>
      unsynced.push([path, String(error)]),
    );

    const path = files.write(memoryIn(USER));

    expect(unsynced).toEqual([[path, "Error: EIO"]]);
  });

  test("removing a memory that was never written is not an error", () => {
    const files = createMemoryFiles(tempRoot(), nodeFileSystem);

    expect(() => files.removeAll(memoryIn(USER).id)).not.toThrow();
  });

  test("reports the modification time of a file and nothing for a missing one", () => {
    const files = createMemoryFiles(tempRoot(), nodeFileSystem);
    const path = files.write(memoryIn(USER));

    expect(files.mtimeMs(path)).toBeGreaterThan(0);
    expect(files.mtimeMs(`${path}.missing`)).toBeUndefined();
  });
});

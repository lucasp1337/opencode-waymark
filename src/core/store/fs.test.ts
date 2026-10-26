import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDirs } from "../../../test/temp-dir";
import { nodeFileSystem as fs } from "./fs";

const tempDir = useTempDirs();

describe("nodeFileSystem", () => {
  test("writeAtomic creates parent dirs and leaves no temp file behind", () => {
    const dir = tempDir();
    const file = join(dir, "a", "b", "m.md");

    fs.writeAtomic(file, "one");
    fs.writeAtomic(file, "two");

    expect(fs.readText(file)).toBe("two");
    expect(readdirSync(join(dir, "a", "b"))).toEqual(["m.md"]);
  });

  test("a failed atomic write leaves the previous content intact", () => {
    const dir = tempDir();
    const file = join(dir, "m.md");
    fs.writeAtomic(file, "kept");
    mkdirSync(`${file}.tmp`);

    expect(() => fs.writeAtomic(file, "lost")).toThrow();
    expect(fs.readText(file)).toBe("kept");
  });

  test("readText and mtimeMs report a missing file as undefined", () => {
    const file = join(tempDir(), "missing.md");

    expect(fs.readText(file)).toBeUndefined();
    expect(fs.mtimeMs(file)).toBeUndefined();
  });

  test("readText throws for errors other than a missing file", () => {
    expect(() => fs.readText(tempDir())).toThrow();
  });

  test("listFiles walks subdirectories and returns nothing for a missing dir", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "x", "y"), { recursive: true });
    writeFileSync(join(dir, "top.md"), "");
    writeFileSync(join(dir, "x", "y", "deep.md"), "");

    expect(fs.listFiles(dir).sort()).toEqual([join(dir, "top.md"), join(dir, "x", "y", "deep.md")]);
    expect(fs.listFiles(join(dir, "nope"))).toEqual([]);
  });

  test("listFiles rethrows when the path is a file", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "f"), "");

    expect(() => fs.listFiles(join(dir, "f"))).toThrow();
  });

  test("remove deletes a file and ignores a missing one", () => {
    const file = join(tempDir(), "m.md");
    fs.writeAtomic(file, "x");

    fs.remove(file);
    fs.remove(file);

    expect(fs.readText(file)).toBeUndefined();
  });

  test("mtimeMs reports the modification time of an existing file", () => {
    const file = join(tempDir(), "m.md");
    fs.writeAtomic(file, "x");
    utimesSync(file, 1_700_000_000, 1_700_000_000);

    expect(fs.mtimeMs(file)).toBe(1_700_000_000_000);
  });
});

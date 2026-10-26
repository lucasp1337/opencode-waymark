import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FileSystem, nodeFileSystem } from "../store/fs";
import { registerOrg } from "./registry";

const acme = { id: "github.com/acme", owner: "acme" };
const dirs: string[] = [];

function registryFile(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "waymark-registry-"));
  dirs.push(dir);
  const file = join(dir, "registry.json");
  if (content !== undefined) {
    writeFileSync(file, content);
  }
  return file;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function countingFileSystem(): { fs: FileSystem; writes: string[] } {
  const writes: string[] = [];
  const fs: FileSystem = {
    ...nodeFileSystem,
    writeAtomic(path, text) {
      writes.push(path);
      nodeFileSystem.writeAtomic(path, text);
    },
  };
  return { fs, writes };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("registerOrg", () => {
  test("the first registration creates the file and reports the org as added", () => {
    const file = registryFile();

    expect(registerOrg(nodeFileSystem, file, acme)).toEqual({ ok: true, value: "added" });
    expect(readJson(file)).toEqual({ orgs: { "github.com/acme": { owner: "acme" } } });
  });

  test("a known org is reported as known and the file is not rewritten", () => {
    const file = registryFile();
    const { fs, writes } = countingFileSystem();
    registerOrg(fs, file, acme);

    expect(registerOrg(fs, file, acme)).toEqual({ ok: true, value: "known" });
    expect(writes).toHaveLength(1);
  });

  test("a second org is added next to the first", () => {
    const file = registryFile();
    registerOrg(nodeFileSystem, file, acme);

    registerOrg(nodeFileSystem, file, { id: "gitlab.com/group/sub", owner: "group/sub" });

    expect(readJson(file)).toEqual({
      orgs: {
        "github.com/acme": { owner: "acme" },
        "gitlab.com/group/sub": { owner: "group/sub" },
      },
    });
  });

  test("keys and org fields this version does not know are preserved", () => {
    const file = registryFile(
      JSON.stringify({ version: 2, orgs: { "github.com/other": { owner: "other", note: "x" } } }),
    );

    registerOrg(nodeFileSystem, file, acme);

    expect(readJson(file)).toEqual({
      version: 2,
      orgs: {
        "github.com/other": { owner: "other", note: "x" },
        "github.com/acme": { owner: "acme" },
      },
    });
  });

  test("a registry without an orgs key gets one", () => {
    const file = registryFile(JSON.stringify({ version: 2 }));

    registerOrg(nodeFileSystem, file, acme);

    expect(readJson(file)).toEqual({ version: 2, orgs: { "github.com/acme": { owner: "acme" } } });
  });

  test("corrupt JSON is reported and the file is left unchanged", () => {
    const file = registryFile("{ not json");
    const { fs, writes } = countingFileSystem();

    const result = registerOrg(fs, file, acme);

    expect(result.ok).toBe(false);
    expect(writes).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe("{ not json");
  });

  test.each([
    ["a JSON array", "[]"],
    ["a JSON string", '"text"'],
    ["null", "null"],
    ["orgs that is an array", '{"orgs":[]}'],
    ["orgs that is a string", '{"orgs":"acme"}'],
    ["orgs that is null", '{"orgs":null}'],
  ])("a registry that is %s is reported and left unchanged", (_case, content) => {
    const file = registryFile(content);
    const { fs, writes } = countingFileSystem();

    expect(registerOrg(fs, file, acme).ok).toBe(false);
    expect(writes).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(content);
  });

  test("the error names the registry file", () => {
    const file = registryFile("[]");

    const result = registerOrg(nodeFileSystem, file, acme);

    expect(!result.ok && result.error.includes(file)).toBe(true);
  });

  test("an I/O error from the file system propagates instead of becoming an error value", () => {
    const fs: FileSystem = {
      ...nodeFileSystem,
      readText() {
        throw new Error("disk unreadable");
      },
    };

    expect(() => registerOrg(fs, registryFile(), acme)).toThrow("disk unreadable");
  });
});

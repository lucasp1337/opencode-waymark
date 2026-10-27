import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FileSystem, nodeFileSystem } from "../store/fs";
import { checkMerge, recordMerge, resolveOrg } from "./registry";

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

describe("resolveOrg", () => {
  test("the first registration creates the file and reports the org as added", () => {
    const file = registryFile();

    expect(resolveOrg(nodeFileSystem, file, acme)).toEqual({
      ok: true,
      value: { id: acme.id, added: true },
    });
    expect(readJson(file)).toEqual({ orgs: { "github.com/acme": { owner: "acme" } } });
  });

  test("a known org is reported as known and the file is not rewritten", () => {
    const file = registryFile();
    const { fs, writes } = countingFileSystem();
    resolveOrg(fs, file, acme);

    expect(resolveOrg(fs, file, acme)).toEqual({
      ok: true,
      value: { id: acme.id, added: false },
    });
    expect(writes).toHaveLength(1);
  });

  test("a second org is added next to the first", () => {
    const file = registryFile();
    resolveOrg(nodeFileSystem, file, acme);

    resolveOrg(nodeFileSystem, file, { id: "gitlab.com/group/sub", owner: "group/sub" });

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

    resolveOrg(nodeFileSystem, file, acme);

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

    resolveOrg(nodeFileSystem, file, acme);

    expect(readJson(file)).toEqual({ version: 2, orgs: { "github.com/acme": { owner: "acme" } } });
  });

  test("corrupt JSON is reported and the file is left unchanged", () => {
    const file = registryFile("{ not json");
    const { fs, writes } = countingFileSystem();

    const result = resolveOrg(fs, file, acme);

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

    expect(resolveOrg(fs, file, acme).ok).toBe(false);
    expect(writes).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(content);
  });

  test("the error names the registry file", () => {
    const file = registryFile("[]");

    const result = resolveOrg(nodeFileSystem, file, acme);

    expect(!result.ok && result.error.includes(file)).toBe(true);
  });

  test("an I/O error from the file system propagates instead of becoming an error value", () => {
    const fs: FileSystem = {
      ...nodeFileSystem,
      readText() {
        throw new Error("disk unreadable");
      },
    };

    expect(() => resolveOrg(fs, registryFile(), acme)).toThrow("disk unreadable");
  });
});

const labs = { id: "github.com/acme-labs", owner: "acme-labs" };
const umbrella = { id: "github.com/umbrella", owner: "umbrella" };
const merge = { into: acme.id, from: labs.id };

function registryWith(...orgs: Array<{ id: string; owner: string }>): string {
  const file = registryFile();
  for (const org of orgs) {
    resolveOrg(nodeFileSystem, file, org);
  }
  return file;
}

describe("recordMerge", () => {
  test("records the merged org as an alias of the kept org and keeps both in orgs", () => {
    const file = registryWith(acme, labs);

    expect(recordMerge(nodeFileSystem, file, merge)).toEqual({ ok: true, value: undefined });
    expect(readJson(file)).toEqual({
      orgs: {
        "github.com/acme": { owner: "acme" },
        "github.com/acme-labs": { owner: "acme-labs" },
      },
      aliases: { "github.com/acme-labs": "github.com/acme" },
    });
  });

  test("keys this version does not know survive the merge", () => {
    const file = registryFile(
      JSON.stringify({
        version: 2,
        orgs: { [acme.id]: { owner: "acme" }, [labs.id]: { owner: "acme-labs" } },
      }),
    );

    recordMerge(nodeFileSystem, file, merge);

    expect(readJson(file)).toMatchObject({ version: 2 });
  });

  test("a merge into a third org repoints the aliases that pointed at the merged org", () => {
    const file = registryWith(acme, labs, umbrella);
    recordMerge(nodeFileSystem, file, merge);

    recordMerge(nodeFileSystem, file, { into: umbrella.id, from: acme.id });

    expect(readJson(file)).toMatchObject({
      aliases: { [labs.id]: umbrella.id, [acme.id]: umbrella.id },
    });
  });

  test("writes only once, atomically", () => {
    const file = registryWith(acme, labs);
    const { fs, writes } = countingFileSystem();

    recordMerge(fs, file, merge);

    expect(writes).toEqual([file]);
  });

  test("a refused merge leaves the file untouched", () => {
    const file = registryWith(acme);
    const before = readFileSync(file, "utf8");
    const { fs, writes } = countingFileSystem();

    const result = recordMerge(fs, file, merge);

    expect(result.ok).toBe(false);
    expect(writes).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("an unreadable registry is reported and left unchanged", () => {
    const file = registryFile("{ not json");

    const result = recordMerge(nodeFileSystem, file, merge);

    expect(!result.ok && result.error).toBe(`registry ${file} is not valid JSON`);
    expect(readFileSync(file, "utf8")).toBe("{ not json");
  });
});

describe("checkMerge", () => {
  test("accepts two known orgs without writing", () => {
    const file = registryWith(acme, labs);
    const before = readFileSync(file, "utf8");

    expect(checkMerge(nodeFileSystem, file, merge)).toEqual({ ok: true, value: undefined });
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("refuses merging an org into itself", () => {
    const file = registryWith(acme);

    expect(checkMerge(nodeFileSystem, file, { into: acme.id, from: acme.id })).toEqual({
      ok: false,
      error: "an org cannot be merged into itself",
    });
  });

  test("refuses unknown orgs, naming each and the known ones", () => {
    const file = registryWith(acme);

    expect(checkMerge(nodeFileSystem, file, { into: "x/one", from: "x/two" })).toEqual({
      ok: false,
      error: "unknown org x/one and x/two; known orgs: github.com/acme",
    });
  });

  test("says so when no org is known at all", () => {
    expect(checkMerge(nodeFileSystem, registryFile(), merge)).toEqual({
      ok: false,
      error: "unknown org github.com/acme and github.com/acme-labs; known orgs: none",
    });
  });

  test("refuses an org that was already merged away", () => {
    const file = registryWith(acme, labs, umbrella);
    recordMerge(nodeFileSystem, file, merge);

    expect(checkMerge(nodeFileSystem, file, { into: umbrella.id, from: labs.id })).toEqual({
      ok: false,
      error: "github.com/acme-labs was already merged into github.com/acme",
    });
  });

  test("refuses to merge into an org that was merged away", () => {
    const file = registryWith(acme, labs, umbrella);
    recordMerge(nodeFileSystem, file, merge);

    expect(checkMerge(nodeFileSystem, file, { into: labs.id, from: umbrella.id })).toEqual({
      ok: false,
      error: "github.com/acme-labs was merged into github.com/acme; merge into that org instead",
    });
  });
});

describe("resolveOrg after merges", () => {
  test("a missing registry resolves an org to itself and registers it", () => {
    expect(resolveOrg(nodeFileSystem, registryFile(), acme)).toEqual({
      ok: true,
      value: { id: acme.id, added: true },
    });
  });

  test("a merged org resolves to the org that absorbed it", () => {
    const file = registryWith(acme, labs);
    recordMerge(nodeFileSystem, file, merge);

    expect(resolveOrg(nodeFileSystem, file, labs)).toEqual({
      ok: true,
      value: { id: acme.id, added: false },
    });
  });

  test("a merged org that is missing from orgs is not registered again", () => {
    const file = registryFile(JSON.stringify({ aliases: { [labs.id]: acme.id } }));
    const { fs, writes } = countingFileSystem();

    expect(resolveOrg(fs, file, labs)).toEqual({
      ok: true,
      value: { id: acme.id, added: false },
    });
    expect(writes).toEqual([]);
  });

  test.each([
    ["aliases that is an array", '{"aliases":[]}', '"aliases" must be a JSON object'],
    ["aliases that is null", '{"aliases":null}', '"aliases" must be a JSON object'],
    [
      "an alias that is not an org id",
      '{"aliases":{"a":1}}',
      '"aliases" must map org ids to org ids',
    ],
  ])("a registry with %s is reported and left unchanged", (_case, content, problem) => {
    const file = registryFile(content);
    const { fs, writes } = countingFileSystem();

    expect(resolveOrg(fs, file, acme)).toEqual({
      ok: false,
      error: `registry ${file} ${problem}`,
    });
    expect(writes).toEqual([]);
  });

  test("an org id that looks like an object property is just another org", () => {
    expect(
      resolveOrg(nodeFileSystem, registryWith(acme), { id: "constructor", owner: "x" }),
    ).toEqual({
      ok: true,
      value: { id: "constructor", added: true },
    });
  });
});

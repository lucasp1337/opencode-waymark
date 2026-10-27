import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDirs } from "../../../test/temp-dir";
import type { LogLevel } from "../port";
import { type FileSystem, nodeFileSystem } from "../store/fs";
import { openConfigStore } from "./config-store";
import { settingsFrom } from "./settings";

const tempDir = useTempDirs();

interface LogLine {
  readonly level: LogLevel;
  readonly msg: string;
  readonly data: unknown;
}

// `broken` replaces single file operations to simulate I/O failures.
function setup(broken: Partial<FileSystem> = {}) {
  const file = join(tempDir(), "config.jsonc");
  const logs: LogLine[] = [];
  const reads = { count: 0 };
  const fs: FileSystem = {
    ...nodeFileSystem,
    readText(path) {
      reads.count += 1;
      return nodeFileSystem.readText(path);
    },
    ...broken,
  };
  const store = openConfigStore(fs, file, (level, msg, data) => logs.push({ level, msg, data }));
  return { file, logs, reads, store };
}

const unreadable = () => {
  throw new Error("EACCES: permission denied");
};

// Distinct mtimes make a rewrite visible without waiting for the clock to move.
function writeConfig(file: string, text: string, mtimeSeconds: number): void {
  writeFileSync(file, text);
  utimesSync(file, mtimeSeconds, mtimeSeconds);
}

describe("current", () => {
  test("a missing file gives the defaults without logging", () => {
    const { store, logs } = setup();

    expect(store.current()).toEqual(settingsFrom({}));
    expect(logs).toEqual([]);
  });

  test("reads the settings from the file", () => {
    const { store, file } = setup();
    writeConfig(file, '{ // set by hand\n "preset": "rich", "toasts": false }', 1000);

    expect(store.current()).toEqual(settingsFrom({ preset: "rich", toasts: false }));
  });

  test("does not read the file again while its mtime is unchanged", () => {
    const { store, file, reads } = setup();
    writeConfig(file, '{"preset": "lean"}', 1000);
    store.current();

    store.current();
    writeConfig(file, '{"preset": "rich"}', 1000);

    expect(reads.count).toBe(1);
    expect(store.current().preset).toBe("lean");
  });

  test("reads the file again once its mtime changed", () => {
    const { store, file } = setup();
    writeConfig(file, '{"preset": "lean"}', 1000);
    store.current();

    writeConfig(file, '{"preset": "rich"}', 2000);

    expect(store.current().preset).toBe("rich");
  });

  test("picks up a file created after the first read", () => {
    const { store, file } = setup();
    store.current();

    writeConfig(file, '{"toasts": false}', 1000);

    expect(store.current().toasts).toBe(false);
  });

  test("goes back to the defaults when the file is deleted", () => {
    const { store, file } = setup();
    writeConfig(file, '{"toasts": false}', 1000);
    store.current();

    nodeFileSystem.remove(file);

    expect(store.current().toasts).toBe(true);
  });

  test("an invalid file gives the defaults", () => {
    const { store, file } = setup();
    writeConfig(file, '{"preset": "huge"}', 1000);

    expect(store.current()).toEqual(settingsFrom({}));
  });

  test("an invalid file is logged once per change with its problems", () => {
    const { store, file, logs } = setup();
    writeConfig(file, '{"preset": "huge"}', 1000);

    store.current();
    store.current();
    writeConfig(file, '{"indexLines": 0}', 2000);
    store.current();

    expect(logs).toEqual([
      {
        level: "warn",
        msg: "config file unusable; using defaults",
        data: { file, problems: ["preset must be one of lean, balanced, rich"] },
      },
      {
        level: "warn",
        msg: "config file unusable; using defaults",
        data: { file, problems: ["indexLines must be a positive integer"] },
      },
    ]);
  });
});

describe("current with an unreadable file", () => {
  test("gives the defaults", () => {
    const { store, file } = setup({ readText: unreadable });
    writeConfig(file, '{"toasts": false}', 1000);

    expect(store.current()).toEqual(settingsFrom({}));
  });

  test("logs the read error once per change", () => {
    const { store, file, logs } = setup({ readText: unreadable });
    writeConfig(file, "{}", 1000);

    store.current();
    store.current();
    writeConfig(file, "{}", 2000);
    store.current();

    expect(logs).toEqual([
      {
        level: "warn",
        msg: "config file unusable; using defaults",
        data: { file, problems: ["cannot read the file: Error: EACCES: permission denied"] },
      },
      {
        level: "warn",
        msg: "config file unusable; using defaults",
        data: { file, problems: ["cannot read the file: Error: EACCES: permission denied"] },
      },
    ]);
  });

  test("a directory in place of the file gives the defaults", () => {
    const { store, file } = setup();
    mkdirSync(file);

    expect(store.current()).toEqual(settingsFrom({}));
  });

  test("update leaves it alone and asks for it to be fixed or removed", () => {
    const { store, file } = setup({ readText: unreadable });
    writeConfig(file, '{"toasts": false}', 1000);

    const result = store.update({ preset: "lean" });

    expect(result).toEqual({
      ok: false,
      error: [
        `${file} cannot be used, so nothing was changed; ask the user to fix or remove it`,
        "cannot read the file: Error: EACCES: permission denied",
      ],
    });
    expect(readFileSync(file, "utf8")).toBe('{"toasts": false}');
  });
});

describe("current with a file that cannot be examined", () => {
  test("gives the defaults", () => {
    const { store } = setup({ mtimeMs: unreadable });

    expect(store.current()).toEqual(settingsFrom({}));
  });

  test("logs once until the file can be examined again", () => {
    let broken = true;
    const { store, file, logs } = setup({
      mtimeMs: (path) => (broken ? unreadable() : nodeFileSystem.mtimeMs(path)),
    });

    store.current();
    store.current();
    broken = false;
    writeConfig(file, '{"preset": "rich"}', 1000);

    expect(store.current()).toEqual(settingsFrom({ preset: "rich" }));
    expect(logs).toEqual([
      {
        level: "warn",
        msg: "config file unusable; using defaults",
        data: { file, problems: ["cannot examine the file: Error: EACCES: permission denied"] },
      },
    ]);
  });
});

describe("exists", () => {
  test("is false until the file is written", () => {
    const { store, file } = setup();

    expect(store.exists()).toBe(false);
    writeConfig(file, "{}", 1000);
    expect(store.exists()).toBe(true);
  });

  test("is true for an invalid file", () => {
    const { store, file } = setup();
    writeConfig(file, "not json", 1000);

    expect(store.exists()).toBe(true);
  });

  test("is true and logs when the file cannot be examined", () => {
    const { store, file, logs } = setup({ mtimeMs: unreadable });

    expect(store.exists()).toBe(true);
    expect(logs).toEqual([
      {
        level: "warn",
        msg: "config file cannot be examined",
        data: { file, problem: "cannot examine the file: Error: EACCES: permission denied" },
      },
    ]);
  });
});

describe("update", () => {
  test("creates the file and returns the new settings", () => {
    const { store, file } = setup();

    const result = store.update({ preset: "lean", toasts: false });

    expect(result).toEqual({ ok: true, value: settingsFrom({ preset: "lean", toasts: false }) });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ preset: "lean", toasts: false });
  });

  test("current returns the updated settings", () => {
    const { store } = setup();

    store.update({ caps: { repo: 900 } });

    expect(store.current().caps.repo).toBe(900);
  });

  test("keeps what the file already says", () => {
    const { store, file } = setup();
    writeConfig(file, '{"indexLines": 12, "caps": {"user": 100}}', 1000);

    store.update({ caps: { repo: 900 }, toasts: false });

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      indexLines: 12,
      caps: { user: 100, repo: 900 },
      toasts: false,
    });
  });

  test("writes pretty JSON ending in a newline", () => {
    const { store, file } = setup();

    store.update({ toasts: false });

    expect(readFileSync(file, "utf8")).toBe('{\n  "toasts": false\n}\n');
  });

  test("leaves no temporary file behind", () => {
    const { store, file } = setup();

    store.update({ toasts: false });

    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  test("drops the comments of a hand-edited file", () => {
    const { store, file } = setup();
    writeConfig(file, '{ // keep it small\n "preset": "lean" }', 1000);

    store.update({ toasts: false });

    expect(readFileSync(file, "utf8")).not.toContain("keep it small");
  });

  test("rejects a patch with an invalid value and writes nothing", () => {
    const { store, file } = setup();

    const result = store.update({ indexLines: -5 });

    expect(result).toEqual({ ok: false, error: ["indexLines must be a positive integer"] });
    expect(existsSync(file)).toBe(false);
  });

  test("refuses to overwrite an invalid file and reports its problems", () => {
    const { store, file } = setup();
    writeConfig(file, '{"preset": "huge"}', 1000);

    const result = store.update({ toasts: false });

    expect(result).toEqual({
      ok: false,
      error: [
        `${file} cannot be used, so nothing was changed; ask the user to fix or remove it`,
        "preset must be one of lean, balanced, rich",
      ],
    });
    expect(readFileSync(file, "utf8")).toBe('{"preset": "huge"}');
  });

  test("a failed write propagates and leaves the file and the settings as they were", () => {
    const failing = setup({
      writeAtomic() {
        throw new Error("ENOSPC: no space left on device");
      },
    });
    writeConfig(failing.file, '{"preset": "lean"}', 1000);
    failing.store.current();

    expect(() => failing.store.update({ preset: "rich" })).toThrow("ENOSPC");

    expect(readFileSync(failing.file, "utf8")).toBe('{"preset": "lean"}');
    expect(failing.store.current().preset).toBe("lean");
  });

  test("a later hand edit is read after an update", () => {
    const { store, file } = setup();
    store.update({ toasts: false });

    writeConfig(file, '{"toasts": true, "preset": "rich"}', 5000);

    expect(store.current().preset).toBe("rich");
  });
});

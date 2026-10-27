import { err, ok, type Result } from "../model/result";
import type { HostPort } from "../port";
import type { FileSystem } from "../store/fs";
import { parseConfig, parseConfigValue } from "./config-file";
import { type ConfigFile, mergeConfig, type Settings, settingsFrom } from "./settings";

export interface ConfigStore {
  // Re-reads the file only when its mtime changed. A missing, invalid or unreadable file, or one
  // that cannot even be examined, gives the defaults.
  current(): Settings;
  // True for any file at the path, readable or not.
  exists(): boolean;
  // Merges the patch into the file and writes it. A failed write throws and changes nothing.
  update(patch: ConfigFile): Result<Settings, string[]>;
}

interface Snapshot {
  // What was looked at: the file's mtime, its absence, or a failed look.
  readonly version: string;
  // What the file says, or why it cannot be used.
  readonly content: Result<ConfigFile, string[]>;
  readonly settings: Settings;
}

function snapshotOf(version: string, content: Result<ConfigFile, string[]>): Snapshot {
  return { version, content, settings: settingsFrom(content.ok ? content.value : {}) };
}

type Stat = Result<number | undefined, string>;

function versionOf(stat: Stat): string {
  if (!stat.ok) {
    return "unexaminable";
  }
  return stat.value === undefined ? "missing" : `mtime ${stat.value}`;
}

export function openConfigStore(fs: FileSystem, file: string, log: HostPort["log"]): ConfigStore {
  let snapshot: Snapshot | undefined;

  function readContent(): Result<ConfigFile, string[]> {
    try {
      const text = fs.readText(file);
      return text === undefined ? ok({}) : parseConfig(text);
    } catch (error) {
      return err([`cannot read the file: ${String(error)}`]);
    }
  }

  function stat(): Stat {
    try {
      return ok(fs.mtimeMs(file));
    } catch (error) {
      return err(`cannot examine the file: ${String(error)}`);
    }
  }

  function fresh(): Snapshot {
    const looked = stat();
    const version = versionOf(looked);
    if (snapshot?.version === version) {
      return snapshot;
    }
    // The mtime is read before the text, so a write in between is picked up on the next call.
    const content = looked.ok ? readContent() : err([looked.error]);
    if (!content.ok) {
      log("warn", "config file unusable; using defaults", { file, problems: content.error });
    }
    snapshot = snapshotOf(version, content);
    return snapshot;
  }

  return {
    current: () => fresh().settings,
    exists() {
      const looked = stat();
      if (looked.ok) {
        return looked.value !== undefined;
      }
      // Not being able to look is no evidence that the file is missing, and the only caller uses
      // a "no file" answer to suggest setup.
      log("warn", "config file cannot be examined", { file, problem: looked.error });
      return true;
    },
    update(patch) {
      const { content } = fresh();
      if (!content.ok) {
        return err([
          `${file} cannot be used, so nothing was changed; ask the user to fix or remove it`,
          ...content.error,
        ]);
      }
      const merged = parseConfigValue(mergeConfig(content.value, patch));
      if (!merged.ok) {
        return merged;
      }
      // A hand-edited file loses its comments: the file is rewritten from the parsed content.
      fs.writeAtomic(file, `${JSON.stringify(merged.value, null, 2)}\n`);
      snapshot = snapshotOf(versionOf(stat()), merged);
      return ok(snapshot.settings);
    },
  };
}

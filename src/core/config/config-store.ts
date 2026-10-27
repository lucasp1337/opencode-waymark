import { err, ok, type Result } from "../model/result";
import type { HostPort } from "../port";
import type { FileSystem } from "../store/fs";
import { parseConfig, parseConfigValue } from "./config-file";
import { type ConfigFile, mergeConfig, type Settings, settingsFrom } from "./settings";

export interface ConfigStore {
  // Re-reads the file only when its mtime changed. A missing, invalid or unreadable file gives the
  // defaults.
  current(): Settings;
  // True for any file at the path, readable or not.
  exists(): boolean;
  // Merges the patch into the file and writes it. A failed write throws and changes nothing.
  update(patch: ConfigFile): Result<Settings, string[]>;
}

interface Snapshot {
  readonly mtimeMs: number | undefined;
  // What the file says, or why it cannot be used.
  readonly content: Result<ConfigFile, string[]>;
  readonly settings: Settings;
}

function snapshotOf(mtimeMs: number | undefined, content: Result<ConfigFile, string[]>): Snapshot {
  return { mtimeMs, content, settings: settingsFrom(content.ok ? content.value : {}) };
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

  function fresh(): Snapshot {
    const mtimeMs = fs.mtimeMs(file);
    if (snapshot !== undefined && snapshot.mtimeMs === mtimeMs) {
      return snapshot;
    }
    // The mtime is read before the text, so a write in between is picked up on the next call.
    const content = readContent();
    if (!content.ok) {
      log("warn", "config file unusable; using defaults", { file, problems: content.error });
    }
    snapshot = snapshotOf(mtimeMs, content);
    return snapshot;
  }

  return {
    current: () => fresh().settings,
    exists() {
      try {
        return fs.mtimeMs(file) !== undefined;
      } catch (error) {
        // Not being able to look is no evidence that the file is missing, and the only caller
        // uses a "no file" answer to suggest setup.
        log("warn", "config file cannot be examined", { file, error: String(error) });
        return true;
      }
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
      snapshot = snapshotOf(fs.mtimeMs(file), merged);
      return ok(snapshot.settings);
    },
  };
}

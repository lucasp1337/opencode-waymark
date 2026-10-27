import type { ConfigStore } from "../../config/config-store";
import { DEFAULT_PRESET } from "../../config/preset-name";
import { presetLabel } from "../../config/settings-text";
import { notify } from "../../notify";
import type { HostPort } from "../../port";

interface FirstSessionDeps {
  readonly host: Pick<HostPort, "capabilities" | "toast" | "log">;
  readonly config: Pick<ConfigStore, "exists">;
}

// Setup is never automatic: Waymark only mentions it, once per activation, until a config file
// exists. Without one, the settings are the defaults, so the default preset is the active one.
export function createFirstSessionNotice(deps: FirstSessionDeps): () => Promise<void> {
  let shown = false;
  return async () => {
    if (shown || deps.config.exists()) {
      return;
    }
    shown = true;
    await notify(
      deps.host,
      `waymark on (${presetLabel(DEFAULT_PRESET)}) · /memory setup to customize`,
    );
  };
}

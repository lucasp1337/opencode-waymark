# Waymark

An [opencode](https://opencode.ai) plugin that gives agents persistent, local-only memory across sessions.

## Compatibility

| Waymark | opencode | `@opencode-ai/plugin` | Bun |
| --- | --- | --- | --- |
| 0.1.0 | 1.19.4 | 1.19.4 | 1.4.4 |

The SDK is pinned to the exact opencode version it is tested against.

## Install

Add Waymark to the `plugin` list in `opencode.json` (project) or `~/.config/opencode/opencode.json` (global):

```json
{
  "plugin": ["opencode-waymark"]
}
```

Restart opencode. It installs the package on startup. opencode loads plugin code once per process, so restart it after updating too.

New to Waymark? The [guide](docs/guide.md) explains its words, every command, the settings and where memories live.

### From source

Link the entry file into opencode's global plugin directory (`plugin/` or `plugins/` under the opencode config directory):
 
```sh
ln -s "$PWD/src/index.ts" ~/.config/opencode/plugin/waymark.ts
```

## Embedding model

Waymark checks for near-duplicates when you save, and `memory_search` matches by meaning as well as by words. For that it uses a small local embedding model, `Xenova/multilingual-e5-small` (quantized q8, multilingual).

- **Download:** on first activation, about 130 MB, once. After that it works offline.
- **Disk:** the install also pulls the ONNX runtime (about 450 MB). With the model, plan for about 600 MB.
- **Cache:** `$XDG_DATA_HOME/waymark/models/` (default `~/.local/share/waymark/models/`). Safe to delete; it is fetched again.
- **Runtime:** runs locally on CPU, no GPU needed. Expect roughly 450 MB of RAM while it is loaded (measured with Bun, one process).
- **Offline or failed download:** Waymark logs a warning and falls back to text matching only. Memories still save and are found by words. It tries again at the next start.

There is, currently, no setting to turn the model off.

## Data

Nothing is written inside your repositories.

- Memories: `$XDG_DATA_HOME/waymark/` (default `~/.local/share/waymark/`)
- Config: `$XDG_DATA_HOME/waymark/config.jsonc`
- Embedding model cache: `$XDG_DATA_HOME/waymark/models/`
- Log: `$XDG_STATE_HOME/waymark/waymark.log` (default `~/.local/state/waymark/`)

## Development

```sh
bun install
bun run test        # unit tests + coverage
bun run lint        # biome + knip
bun run typecheck   # tsc --noEmit
bun run test:live   # live contract tests against a real opencode (makes model calls)
```

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, checks and commit messages. Please report security issues privately as described in [SECURITY.md](SECURITY.md). Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

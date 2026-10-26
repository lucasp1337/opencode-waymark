# Waymark

An [opencode](https://opencode.ai) plugin that gives agents persistent, local-only memory across sessions.

## Compatibility

| Waymark | opencode | `@opencode-ai/plugin` | Bun |
| --- | --- | --- | --- |
| 0.0.0 (unreleased) | 1.19.4 | 1.19.4 | 1.4.4 |

The SDK is pinned to the exact opencode version it is tested against.

## Local install

Link the entry file into opencode's global plugin directory (`plugin/` or `plugins/` under the opencode config directory):

```sh
ln -s "$PWD/src/index.ts" ~/.config/opencode/plugin/waymark.ts
```

opencode loads plugin code once per process: restart it after changing the plugin.

## Data

- Log: `$XDG_STATE_HOME/waymark/waymark.log` (default `~/.local/state/waymark/`)

Nothing is written inside your repositories.

## Development

```sh
bun install
bun test            # unit tests
bun run lint        # biome + knip
bun run typecheck   # tsc --noEmit
bun run test:live   # live contract tests against a real opencode (makes model calls)
```

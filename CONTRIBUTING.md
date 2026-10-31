# Contributing to Waymark

Thanks for wanting to help. This page covers setup, the checks every change must pass, how the code is laid out and how to propose something new.

## Setup

You need:

- [Bun](https://bun.sh) 1.4.4
- [opencode](https://opencode.ai) 1.19.4 (only to try the plugin by hand or run the live tests)

```sh
git clone https://github.com/lucasp1337/opencode-waymark.git
cd opencode-waymark
bun install
```

### Load the plugin from source

Link the entry file into opencode's global plugin directory (`plugin/` or `plugins/` under the opencode config directory):

```sh
ln -s "$PWD/src/index.ts" ~/.config/opencode/plugin/waymark.ts
```

opencode loads plugin code once per process, so restart it after each change.

## Commands

```sh
bun run test        # unit tests, with coverage
bun run lint        # biome + knip
bun run typecheck   # tsc --noEmit
```

All three must pass before a change is merged. CI runs them on every pull request.

- `bun run test` enforces at least 90% line, function and statement coverage (see `bunfig.toml`). If it drops below, add tests; do not lower the threshold.
- `bun run lint` runs Biome (formatting and lint rules) and knip (unused files, exports and dependencies).

### Live tests

```sh
bun run test:live                                # every live test
bun run test:live:one test/live/recall.test.ts   # one file
```

Live tests start a real `opencode` (it must be on your `PATH`) with the plugin installed and make real model calls. Each run gets its own temporary config, data and state directories, so your own opencode setup and memories are not touched. CI does not run them.

- `WAYMARK_LIVE_MODEL`: the model to use, as `provider/model`. Defaults to `opencode/big-pickle`. A local model works too, for example one served by Ollama.
- `WAYMARK_LIVE_MODEL_CACHE`: optional. A directory with an already downloaded embedding model, shared across runs so it is not fetched every time.

Run them when you change anything that talks to opencode, and say in the pull request which model you used.

## How the code is laid out

- `src/index.ts` is the entry point. It loads the opencode adapter lazily.
- `src/host/` is the only place that talks to opencode. Only `src/host/v1.ts` imports `@opencode-ai/plugin`.
- `src/core/` holds the logic and never imports from `src/host/` or any opencode package. It talks to the host through the interface in `src/core/port.ts`. Biome enforces this split with `noRestrictedImports`.
- Features live as slices under `src/core/features/` (recall, save, commands, link, setup, lifecycle). Shared building blocks sit next to them: `model/`, `store/`, `scope/`, `config/`.
- Tests sit next to the code they cover (`foo.ts` and `foo.test.ts`) and run against a fake host in `test/fake-host.ts`, not a real opencode.
- Memories are plain markdown files with YAML frontmatter. They are the source of truth. The SQLite search cache is derived from them and can be deleted and rebuilt at any time.
- Waymark never writes inside the user's repositories, and never deletes a memory on its own. Only `memory_forget` deletes.
- A Waymark bug must never fail the user's tool call or message. Hooks and tools catch their own errors, log them to the Waymark log and carry on.
- Hooks must stay fast: no network and no model calls inside them.

## Code style

- TypeScript in strict mode, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- No `any`, no non-null `!`, no `@ts-ignore`, no `console` in `src/`. Use the logger.
- Biome enforces formatting and most of these rules. Run `bun run lint` and fix what it reports instead of adding ignore comments.
- Keep modules small and names plain. Match the code around you.
- Tests check behaviour through public functions, one behaviour per test, named as a sentence. Cover failure paths too.
- No new dependencies without discussing it in an issue first.

## Commit messages

Every commit message starts with one of three types:

- `feat:` a new feature or a change in behaviour
- `fix:` a bug fix
- `chore:` everything else (docs, tests, tooling, refactors, dependency bumps)

A scope in brackets is optional:

```
feat(recall): show the update date on memory lines
fix: keep the session block within the token cap
chore(docs): explain product scopes in the guide
```

No other types (`docs:`, `test:`, `refactor:` and so on).

## Branches and releases

- **One trunk.** `main` is always releasable. Every change lands through a pull request, and CI (typecheck, lint, tests) must pass first.
- **Squash merges only.** The pull request title becomes the commit message on `main`, so it follows the commit format above.
- **Versions are semver on Waymark**, independent of opencode. A break in the memory file format is a major version and ships with a migration note.
- **Releases are annotated tags** `vX.Y.Z` on `main`, listed in [CHANGELOG.md](CHANGELOG.md).
- **opencode compatibility** is pinned in `engines.opencode` in `package.json` and in the README table. The `@opencode-ai/plugin` version is bumped only in a pull request that records a live test run against the new opencode.
- **Maintenance branches on demand.** If a change drops support for an older opencode, first cut `release/<major>.x` from the last compatible tag, then backport fixes with `git cherry-pick -x`.

## Proposing a change

- Small fixes (typos, clear bugs with an obvious fix): open a pull request directly.
- Anything non-trivial, such as a new feature, command, setting or dependency: open a [feature request](https://github.com/lucasp1337/opencode-waymark/issues/new/choose) first. Describe the use case, how it would be used, and its downsides. That saves you from writing code that may not be merged.
- Security issues: do not open a public issue. See [SECURITY.md](SECURITY.md).

By contributing you agree that your work is released under the [MIT License](LICENSE) and that you follow the [Code of Conduct](CODE_OF_CONDUCT.md).

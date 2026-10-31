# Changelog

All notable changes to Waymark are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - unreleased

First release.

### Added

- Persistent, local-only memory for opencode agents, stored as one markdown file per memory under `$XDG_DATA_HOME/waymark/`. Nothing is written inside your repositories.
- Four scopes, from widest to narrowest: `user`, `org` (worked out from the git `origin` remote), `product` (repos you link together) and `repo`.
- Six kinds of memory: `rule`, `preference`, `fact`, `decision`, `gotcha` and `reference`, plus an optional `howToApply` line for rules, preferences and gotchas.
- A session block at session start with rules and preferences in full and an index of facts and decisions. Memory lines show the date they were last updated.
- Gotchas that pop up when the agent touches a matching file, runs a matching command or uses a matching tool.
- Slash commands: `/memory` (list, `review`, `move`, `org merge`, `link`, `unlink`, `setup`), `/remember` and `/forget`.
- Agent tools: `memory_save`, `memory_update`, `memory_read`, `memory_search`, `memory_forget`, `memory_config`, `memory_command` and `memory_link`.
- Search by meaning as well as by words, using a small local embedding model (`Xenova/multilingual-e5-small`). Near-duplicates are shown before saving. Falls back to text matching when the model is unavailable.
- Settings in `config.jsonc` with `lean`, `balanced` and `rich` presets, per-scope token caps, index size and toasts, editable through `/memory setup`.

[Unreleased]: https://github.com/lucasp1337/opencode-waymark/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lucasp1337/opencode-waymark/releases/tag/v0.1.0

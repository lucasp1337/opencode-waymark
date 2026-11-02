# Changelog

All notable changes to Waymark are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A memory policy: a memory holds what you would otherwise have to tell the agent again and what the code, the repo and its docs cannot tell it. [What belongs in a memory](docs/memory-policy.md) explains it with examples.
- A `waymark-save` skill, shipped with the plugin, that the agent loads before it saves or updates a memory. It covers what belongs in memory, which kind and scope to pick, and how to write it. Hosts without skills get the same text in the session instructions.
- `/memory review` now also flags memories that fail the policy, such as functional detail readable from the code, team-wide conventions that belong in `AGENTS.md`, task progress and secrets, and offers to forget or move them.

### Changed

- The save guidance moved out of the always-on session instructions into the skill, so the instructions are shorter. The save triggers, the same-turn rule and the secret rule stay.
- The kind descriptions in the tool schemas say what each kind is for, in line with the policy.

## [0.2.0] - 2026-11-01

### Changed

- Sharper save guidance for the agent: save in the same turn when you say "remember" or "from now on", never copy a secret (token, password, key, connection string) into a memory, only where it lives, and keep other people's personal data to a pointer.
- The embedding model is loaded once per opencode process and shared by every open project, instead of once per project. Three open projects now use about 430 MB instead of about 1 GB.
- `@huggingface/transformers` updated to 4.3.2.

## [0.1.0] - 2026-10-31

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

[Unreleased]: https://github.com/lucasp1337/opencode-waymark/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/lucasp1337/opencode-waymark/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/lucasp1337/opencode-waymark/releases/tag/v0.1.0

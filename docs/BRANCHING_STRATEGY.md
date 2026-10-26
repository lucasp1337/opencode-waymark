# Branching and releases

- **One trunk.** `main` is always releasable. Work lands by PR.
- **No per-host branches.** V1 and V2 differ only in `src/host/`; `core/` is shared.
- **Versions are semver on Waymark**, independent of opencode. The first release is `v0.1.0`. `v1.0.0` comes after real use. A memory file format break is a major and ships a migration note.
- **Releases are annotated tags** `vX.Y.Z` on `main`.
- **Host compatibility:** `engines.opencode` in `package.json` plus a Waymark-to-opencode table in the README. Bump the pinned SDK and `vendor/opencode` tag only in a PR that records the live test results.
- **Maintenance branches on demand:** if a change drops an old host, first cut `release/<major>.x` from the last compatible tag, then backport fixes with `git cherry-pick -x`.
- **CI** (test, lint, typecheck) must pass to merge. Live tests are manual. No force-push to `main`.

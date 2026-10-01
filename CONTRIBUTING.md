# Contributing to Loadstone

Loadstone is a private preview under active development. The project license has not been selected, and this repository is not yet an open-source release. Coordinate contributions with the maintainer until licensing and public reporting channels are finalized.

## Development on Windows

Install Node.js 22 or later and pnpm 11. Clone the repository, then run:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm start
```

The lockfile is authoritative. Commit deliberate dependency updates and regenerated notices together. Electron and esbuild installation scripts are allowed through `pnpm-workspace.yaml`; do not enable unrelated build scripts to bypass a failure.

Tests start actual Electron windows and use temporary workspaces. They use synthetic credentials and installation fixtures. They must not download a real modlist or modify a developer's game, Desktop, or Steam library. `LOADSTONE_DATA_DIR` isolates app state, but does not redirect Desktop or Steam operations; native integration tests explicitly redirect or inject those paths.

## Change workflow

Use a feature branch and a focused pull request. Explain the user-visible problem, final behavior, validation and remaining limits. Run `pnpm check`, `pnpm test`, and `git diff --check`. For native behavior, exercise the real Electron bridge; mocked process fixtures alone do not prove a game works. Add regression tests for data-loss risks, persistence failures and process boundaries. Do not introduce tests that merely repeat presentation code.

Keep filesystem/process access in the main process. Validate IPC input, preserve unrelated files and entries, and keep secrets out of renderer state and diagnostics. Manifest imports must not add arbitrary shell recipes. Use original upstream downloads and retain attribution; do not commit game files, downloaded mods, personal manifests, keys, signed URLs or raw user logs.

## Notices and packaging

```powershell
pnpm notices
pnpm package
```

Notice generation first builds the UI, then combines rendered dependency modules, generated Vite runtime attribution, the installed main-process production graph and the Electron license. Frontend packages are development dependencies because their runtime code is bundled; their notices still ship. The bundle provenance file carries original license texts without machine paths. Review changes to `notices/` before committing. Packaging includes that directory in application resources and retains Electron/Chromium notices. The current portable package is unsigned; it is not the Steam depot build. See [the acceptance plan](docs/1.0-plan.md) and [publication checklist](docs/open-source.md).

Do not treat a passing fixture suite as completion of install-to-play acceptance. Record the exact game, list, engine and application versions for real release validation.

Builds embed the Git commit, dirty-worktree flag and lockfile SHA-256 in `dist/build-info.json`. Source archives without Git metadata report an unknown commit. Diagnostic exports include this build identity so builds with the same preview version can still be distinguished. Exports use an explicit field allowlist; do not add arbitrary log, manifest or credential objects to them.

Run `pnpm audit:publication` before proposing public release. See [publication hygiene findings](docs/publication-audit.md) for the scan scope, classified fixtures, historical personal-path findings and outstanding manual review. The command never rewrites history and does not approve publication.

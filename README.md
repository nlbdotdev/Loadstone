# Loadstone

**Your next playthrough, ready.**

A Windows desktop UI MVP for a curated Bethesda modlist installer, built with Svelte 5, TypeScript, and Electron. Charcoal panels, copper accents, and original cinematic artwork carry the approved Loadstone visual direction into an interactive app.

![Loadstone Discover](docs/screenshots/discover.png)

## Windows preview

Download `Loadstone-0.1.0-Windows.exe` from the repository's private **v0.1.0 preview release**, or run the local copy in `release/`. It is a portable executable: no Node.js, pnpm, or installation wizard is needed to review it. The preview is unsigned.

## Run locally

Requires Node.js 22+ and pnpm 11+.

```powershell
pnpm install
pnpm start
```

```powershell
pnpm check     # Svelte and TypeScript diagnostics
pnpm test      # State-engine tests and real Electron end-to-end tests
pnpm package   # Portable Windows x64 executable in release/
```

To test the actual packaged application and portable wrapper:

```powershell
$env:LOADSTONE_TEST_EXE = "$PWD\release\win-unpacked\Loadstone.exe"
node --test tests/electron.test.mjs
Remove-Item Env:\LOADSTONE_TEST_EXE
node scripts/verify-portable.mjs
```

See [the review checklist and verification notes](docs/review.md).

## Review the MVP

1. Browse Discover; filter by game or search for a setup.
2. Open setup details, then Install setup. Choose an installation plan and start the demo.
3. Pause, resume, cancel, or retry in Downloads. A complete demo takes approximately 20 seconds.
4. Open My library to launch a demo session, verify the simulated profile, or remove it.
5. In Settings, turn **Use dummy data** off to import a live setup manifest and check game/archive compatibility. Turn it back on to restore your demo library. Reduced motion, shortcut preferences, and folder selection persist.
6. Export a privacy-conscious diagnostic summary or reset the demo workspace from Settings. Raw installation output remains local in Downloads.

The demo catalog, requirements, installation sizes, profile validation, launch, and shortcut creation are simulated. Demo mode does not download mods, launch game processes, change game files, or modify Steam. Turning demo mode off prevents demo mutations in the main process as well as hiding sample data in the renderer.

Current source also supports a separate live manifest catalog, Steam game discovery, manual game selection, SHA-256 compatibility checks, destination/storage preflight, and a Wabbajack installation runner with saved jobs, cancellation and retry. See [manifest requirements](docs/manifests.md) and [installation behavior and limits](docs/installation.md). Controlled process tests pass; a full real modlist installation has not yet been verified. Live library launch, profile checks, and desktop/Steam shortcut creation and repair are implemented. Steam integration still needs actual-client acceptance testing. The existing v0.1.0 release predates these features.

Settings now prepares a pinned official Wabbajack runtime, with download/cancel/repair controls, archive and full runtime integrity checks, and a real CLI capability check. See [runtime integration notes](docs/runtime.md). Preparing the engine does not install a modlist.

Settings also validates a Nexus personal API key for private testing, stores it with Windows encryption, and displays account membership and the last verification time. [Account integration notes](docs/nexus.md) describe credential handling and installation requirements. This is not yet a registered public Nexus application.

## Persistence and desktop behavior

Settings and demo state live in `%APPDATA%\Loadstone\state.json` in the packaged app. Active demo installs are restored paused after a restart. Disabling demo mode preserves its state and pauses its jobs. Resetting demo data preserves preferences. Unreadable demo state is backed up before recovery. Live jobs are saved separately in `live-jobs.json`; interrupted live installations require a Windows restart before retry. Native Windows folder/save dialogs, window controls, a single-instance guard, and offline artwork are included.

For isolated automated testing, set `LOADSTONE_DATA_DIR` to a dedicated directory. Never point it at a directory whose files you need to preserve.

## Architecture

- `src/`: Svelte interface, catalog, styling, and typed desktop bridge.
- `electron/main.cjs`: native window, validated IPC, dialogs, and state notifications.
- `electron/preload.cjs`: limited context-isolated bridge; no arbitrary filesystem/process access.
- `electron/store.cjs`: persistent simulated installation state machine.
- `electron/manifest.cjs`, `game-discovery.cjs`, `live-catalog.cjs`: live setup validation, local game discovery, and filesystem preflight.
- `electron/installer.cjs`: durable live jobs, engine process control, credential handoff, and structural profile verification.
- `tests/electron.test.mjs`: real Electron workflows and backend invariants.
- `public/worlds.png`: original AI-generated triptych for the three fictional setups.
- `scripts/create-icon.py`: geometric app icon generator (Pillow needed only to regenerate artwork).

Real install-to-play and Steam-client acceptance testing, plus save-safe maintenance remain necessary before a public installer release. [The 1.0 acceptance plan](docs/1.0-plan.md) tracks the complete release requirements, including open-source documentation, license review and notices.

## Distribution

This repository is private and currently unlicensed. No Wabbajack, MO2, or other GPL application code is incorporated in this MVP. Third-party JavaScript packages retain their respective licenses. The portable Windows preview is unsigned and is not a Steam release.

See [contributor setup](CONTRIBUTING.md), [security reporting](SECURITY.md), [privacy and local data](docs/privacy.md), and [open-source publication gates](docs/open-source.md). Generated [third-party notices](notices/THIRD-PARTY.txt) and the [dependency inventory](notices/dependencies.json) ship with new packages. Two upstream packages currently lack standalone license texts; the inventory records those unresolved notice gaps. GPL-3.0-or-later remains a candidate pending the project license decision and release review.

# Windows Steam depot preparation

`pnpm package:steam` generates a Windows x64 **directory build**, distinct from the self-extracting portable EXE. It stages a new kit under `release/steam/preview-<id>/` without replacing existing kits. This is a private developer preview, not a submitted or approved Steam build.

The kit contains:

- `content/`: the complete Electron application and runtime, including Electron/Chromium and Loadstone dependency notices. The depot must include this entire directory.
- `depot-manifest.json`: source commit, dirty-worktree flag, lockfile hash, application version, launch settings and SHA-256/size for every content file. No build-machine paths are embedded in this manifest.
- `scripts/`: SteamPipe app/depot templates. Replace the two ID placeholders with assigned Steamworks IDs and rename both files to `.vdf`.
- `README.txt`: operator instructions and outstanding release gates.

Build with Node 24 and pnpm 11 from a clean checkout after `pnpm install --frozen-lockfile`, `pnpm check`, and `pnpm test`. A dirty build is identified as dirty, never silently certified. The file inventory is for integrity and provenance; binaries are not claimed to be byte-reproducible or signed. A matching inventory also does not prove absence of secrets or compliance with licenses.

```powershell
pnpm package:steam
node scripts/steam-depot.mjs --verify release/steam/preview-<id>
$env:LOADSTONE_TEST_EXE = (Resolve-Path 'release/steam/preview-<id>/content/Loadstone.exe').Path
node --test tests/electron.test.mjs tests/live.test.mjs tests/nexus.test.mjs tests/onboarding.test.mjs tests/close-guard.test.mjs
Remove-Item Env:LOADSTONE_TEST_EXE
```

To generate preview scripts with assigned IDs directly, run `node scripts/steam-depot.mjs release/steam-unpacked/win-unpacked <app-id> <depot-id>`. This stages a fresh kit. No helper invokes SteamCMD, logs into Steam, uploads content or changes a branch. Templates set `Preview` to `1` and omit `SetLive`; [Valve documents this mode](https://partner.steamgames.com/doc/sdk/uploading) as generating logs and manifests without upload. The Steamworks SDK, account and IDs are supplied separately by the maintainer.

## Steamworks setup and acceptance

Configure the launch executable as `Loadstone.exe`, Windows 64-bit, with no launch arguments and the application root as working directory. Map `content/` as the Windows depot root. Do not point Steam at the portable self-extracting wrapper. Do not bundle `depot-manifest.json`, SteamPipe scripts, upload credentials, user data, downloaded engines, or game/mod archives.

Settings, protected Nexus credentials and installation history stay in Electron's per-user app-data directory, outside the depot. Installed setups and recovery folders belong outside the application directory. Do not configure Steam Cloud for credential files. Test updates and uninstall through the actual Steam client to confirm user data and external setups remain intact; local Electron tests cannot establish Steam behavior.

Before upload or review, verify GPL-3.0-or-later corresponding-source delivery and all shipped notices, finalize asset licensing and Nexus registration, supply a permitted real creator list, complete clean Windows install-to-play acceptance, review public claims/screenshots, and configure support/privacy links. Record the tested source commit and depot build ID. Current builds identify as 0.3.0 creator previews; generating a depot kit does not justify a 1.0 version bump. New workspaces open a welcome screen with explicit live/demo choices. The live choice explains prerequisites and opens engine/account settings without downloading anything. Existing schema-1 workspaces migrate to schema 2 with their selected mode and preferences retained.

[Valve's review process](https://partner.steamgames.com/doc/store/review_process) covers the actual store presence and build. Successful packaging or fixture checks do not establish acceptance by Valve. No Steam upload or actual-client acceptance has occurred through this workflow.

Store copy, disclosures, asset production and reviewer handoff are tracked in the [Steam submission draft](steam-submission.md).

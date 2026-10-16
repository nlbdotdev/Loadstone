# Loadstone development handoff

Checkpoint: **2026-10-16**. Development is being handed back to the maintainer for later continuation. Source and documentation are published in Git; this is still a **0.4.0 developer preview**, not a certified 1.0 release candidate. The complete [1.0 acceptance plan](docs/1.0-plan.md) remains open.

## What is implemented

- Windows Svelte 5/TypeScript/Electron application, separate demo/live state, persistent jobs, diagnostics and narrowly validated native IPC.
- Documented `.loadstone` format with an open implementation, deterministic compiler, package inspection, owned-game/local inputs, original-source acquisition and exact output verification.
- Direct ZIP/7z/RAR reconstruction and fingerprinted BSA-104 inner-file extraction; destination-bound MO2 configuration and declared plugin timestamps.
- Guided native installation, cancellation and reviewed resume, explicit library admission, isolated-profile launch, Desktop/Steam shortcuts, same-version repair, separate-version updates and save-preserving removal/recovery.
- Wabbajack engine preparation and a separate manifest-backed installation path. This does not establish general import compatibility with every Nexus Collection, MO2 instance or modlist format.
- Read-only installed MO2 inventories, source ledgers, archive comparison and nested-BSA mapping. Inventory/source identity, reconstruction and playable acceptance are different checks.
- GPL-3.0-or-later source, contributor/privacy/security guidance, offline notices and distinct portable/Steam-depot packaging workflows.
- Refined shared copper mark, individually rendered Windows icons, draft Steam artwork and a local Svelte handbook. Root [AGENTS.md](AGENTS.md) and the [complete agent edition](handbook/agents.md) are checked with the documentation.

## Verified checkpoint and limits

The implementation checkpoint is [source PR #67](https://github.com/nlbdotdev/Loadstone/pull/67), merged as `a26c112d55b70c2cd239c40c517f1f46b73da9bc`. Its [Windows run](https://github.com/nlbdotdev/Loadstone/actions/runs/38970185925) passed 238 desktop tests with one optional external-runtime skip, three handbook tests and 41 staged-executable tests. Handbook browser coverage includes every catalog page at desktop/mobile widths, search, deep links, keyboard access, copying and local-only content requests. The subsequent documentation handoff is represented by this file's Git revision and PR checks.

A private TTW candidate reached its main menu through the real application, produced a Steam recording and passed complete post-menu file/order checks. Human input, new-game, gameplay, save/reload and controller acceptance were **explicitly deferred**. The unsuccessful automated menu interactions do not establish that normal human controls are broken. See [the versioned acceptance record](docs/native-steam-acceptance.md).

Earlier executable packages and footage retain their original build identity. They do not automatically contain later BSA, source-mapping or branding changes. There is no published playable featured catalog, accepted clean-Windows installation, public Nexus registration or completed Steam submission at this checkpoint.

## Manual human tests still required

Use disposable candidates and saves. Preserve ongoing playthroughs, original game/mod folders and unrelated Steam/Desktop entries. Record the exact app commit, recipe/version, game edition, manager version, result and private evidence location for every check.

| Test | Human action and pass evidence | Current state |
| --- | --- | --- |
| TTW controls and new game | Use normal mouse/keyboard in the timestamp-preserving candidate. Select **New**, reach controllable gameplay and exercise movement, camera and menus. | Deferred; menu launch only is verified. |
| TTW save/reload | Create a uniquely named disposable save, exit normally, relaunch the same profile and reload it. Confirm expected location/progress and isolated saves. Never load an existing playthrough for this check. | Deferred; no save/reload acceptance. |
| Controller | Test the intended controller in gameplay and menus, switching input methods if supported. Record the device and settings. | Deferred. |
| Post-play integrity | Reverify recipe outputs, plugin order/timestamps and protected original profiles/configuration/saves. Classify expected new saves, logs and caches; investigate unexpected static changes. | Post-menu comparison passes; post-play comparison is outstanding. |
| Real provider downloads | Use an authorized Nexus account for a declared original file: manual browser download and local hash verification; automatic acquisition with the required account entitlement; cancellation/retry/cache behavior. Keep credentials and raw logs private. | Browser/account fixture coverage passes; real-account acceptance is outstanding. |
| Clean Windows installation | From owned source games and permitted original downloads, complete a real setup, restart, verify and play. Exercise failure/retry without relying on the developer machine's prepared game directory or cache. | Outstanding; full featured recipes/source gaps must be completed first. |
| Actual-client shortcuts and maintenance | On disposable test setups, test Desktop/Steam launch and repair, running-client protection, save-preserving repair/update/removal and preservation of unrelated entries. Record exact before/after state. | Fixture coverage and bounded real TTW checks exist; full real-client maintenance acceptance is outstanding. |
| Steam delivery | With assigned Steamworks IDs, test the directory depot through the actual client, including update/uninstall and preservation of external setups/user state. Review store crops, copy, notices and source delivery. | Packaging is verified; account/depot/review acceptance remains open. |

Human tests are for the maintainer's later session. Do not resume repeated automated game inputs or treat passing fixtures as completion of these rows.

## Remaining implementation and release work

1. Add bounded, fingerprinted nested ZIP/7z/RAR reconstruction and source mapping. A private MCM investigation identifies original archive → nested 7z `.fomod` → exact installed-file chains; this path is not implemented yet. Do not execute installer scripts to inspect known payloads.
2. Resolve remaining generated/transformed content, root/profile/overwrite reconstruction and prepared prerequisites for the installed TTW, FO3 Remastered and customized FNV baselines. Keep locally edited bytes and enabled/disabled states authoritative.
3. Complete reviewed native recipes, attribution, source permissions and reproducible clean installations before publishing the three Loadstone-maintained featured setups. No game/mod mirrors are authorized by ownership or the source-code license.
4. Complete the manual matrix, real provider registration and acceptance, support/privacy destinations, monitored private security reporting, final asset terms and corresponding-source delivery.
5. Build a new accepted artifact from a clean revision, verify its exact source and notices, and repeat the required artifact/clean-machine checks. Only then finalize Git/Steam release copy and a short trailer from that accepted build. Existing development clips are not the final release trailer.
6. Revisit permitted paid storage after rights, cost and account decisions. A feasibility study is not an implemented service; no hosting provider has been provisioned for this feature.

Game direction remains: **Fallout: New Vegas full-support target; standalone Fallout 3 unsupported, use TTW; Fallout 4 and Skyrim in development; Starfield planned and unsupported.** These targets do not certify untested installations.

## Resume from source

Read [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md) and the relevant canonical handbook pages. Use Windows with Node 24 and pnpm 11, and inspect local changes before switching branches or updating dependencies.

```powershell
git status --short --branch
git rev-parse HEAD
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm handbook:check
pnpm handbook:test
```

For complete 7z/RAR test coverage, set `LOADSTONE_TEST_7ZIP` to the trusted tool prepared by `scripts/prepare-sevenzip.ps1` before `pnpm test`; otherwise report the extra skips. The optional external Wabbajack runtime test has its own prerequisite. `pnpm start` runs the desktop app; `pnpm handbook:dev` serves the handbook at `http://127.0.0.1:4174`. The handbook has not been hosted.

Update canonical documentation with behavior changes, run `pnpm handbook:sync`, and commit the generated agent edition. Use feature branches and reviewed PRs. Follow [preview packaging](docs/private-preview.md), [Steam preparation](docs/steam-release.md) and [publication gates](docs/open-source.md) before distributing a binary. Git contains source, docs, generators and synthetic fixtures; local builds, credentials, installed games/mods and private acceptance evidence are deliberately excluded.

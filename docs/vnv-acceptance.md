# Viva New Vegas acceptance candidate

Status: **preflight checked, installation and gameplay not accepted**. This record is from local checks on 2026-10-01 against Loadstone source commit fbd79fd82ea85bfbf512b8f3561835da52292307. It does not authorize publication or describe a supported one-click list.

## Inputs and evidence

- Locally cached Viva New Vegas 11.8.26 by ModdingLinked. Archive SHA-256: `8eaaae1f4c34ca061b178a2a43802ab1f899d380ddc2b84f9bda6be127f33cae`.
- Original pinned Wabbajack 4.2.3.0, prepared from the previously downloaded official ZIP through Loadstone's normal hash/extraction/inventory checks. No engine download was needed.
- Local Steam Fallout: New Vegas 1.4.0.525, six required game-source masters, and a separate empty installation destination. The private manifest reserves 24 GB including downloads and temporary headroom.
- The local manifest pins this host's game files by SHA-256. These are acceptance snapshot identifiers, **not creator-published supported-game hashes**. Existing game modifications have not been ruled out, so this cannot replace clean-machine acceptance.
- Archive metadata declares 153 source archives, 17,630 output files, 3,079,270,181 download bytes and 9,232,895,295 output bytes. Providers are Nexus, HTTP and game-file sources.
- Selected profile: Viva New Vegas Extended. The embedded MO2 configuration contains the New Vegas launch entry, matching the creator's current launch guidance.

The real preflight passed game hash, required files, list archive/metadata, destination/storage, engine integrity and engine game-selection checks. Nexus access failed because the separate Wabbajack application has a saved login that would override Loadstone's connection. Only existence of that credential file was checked; its contents were not read or changed. The isolated Loadstone workspace has no Nexus connection.

The same candidate was opened in the actual Electron application. Its compatibility screen displayed the Nexus blocker and no installation jobs were created. Inspecting that rendered screen also exposed an engine-repair error on the second verification: the CLI had created `logs/wabbajack-cli.current.log` next to its executable. This change permits only the pinned CLI’s regular log filenames while preserving payload verification, rejects injected files in the log folder, and sanitizes executable-relative logs after installer exit. The engine success above describes the initial real preflight; the genuine-engine regression subsequently passed repeated verification, and the actual Electron UI repeated the compatibility check with the engine ready and only the Nexus blocker remaining. Game preparation and install-to-play acceptance remain open. Local JSON reports and a screenshot were retained outside tracked source; game files, the existing modlist installation, Desktop and Steam shortcuts were not modified.

## Required game setup is still missing

The [creator's Wabbajack guide](https://vivanewvegas.moddinglinked.com/wabbajack.html), inspected on 2026-10-01, requires root-file installation and the FNV patcher, plus post-install manager/game checks. The cached archive itself contains `__Files Requiring Manual Install\FNVpatch.exe` and `__Files Requiring Manual Install\nvse_loader.exe`, as well as a Vanilla BSAs Patcher directory. Wabbajack completing its declared output files does not perform or prove all those steps.

Loadstone now supports an optional `launch.gameRoot` declaration for creator-authored Stock Game lists, verifying their archive output and MO2 game/launch paths. The cached VNV archive does not contain that layout. Its required manual game preparation still has no automatic adapter. Structural/output checks could pass while the game is not ready. An already configured developer machine could conceal this gap. Connecting Nexus alone does not resolve it.

Before advertising this candidate as one-click ready:

1. Define creator-declared game preparation requirements and distinguish installed files from a verified launch-ready setup. Imported manifests must not silently imply that external/manual prerequisites are complete.
2. Implement and verify the supported game preparation path. Prefer an isolated game copy when compatible with the list; otherwise define explicit file ownership, original-file backups, expected input/output hashes and rollback before any shared-game write. Do not introduce arbitrary manifest shell commands.
3. Account for executable patching and MO2 target configuration, then repeat compatibility checks on a clean game installation. Runtime download hashes alone do not verify game preparation.
4. Connect a user-provided Nexus account locally and resolve the conflicting Wabbajack login through that application's own UI. Never copy or read another application's saved credential.
5. Run download/install, cancellation/retry, restart, profile launch, creator utility checks, save/load, shortcuts, update coexistence and save-preserving removal acceptance. Record the exact source commit and list/game/engine identities.

No antivirus exclusion or security-setting change has been made. No archive or game asset is included in this repository. This candidate and its private manifest remain local test inputs, not a redistributed or endorsed Loadstone release.

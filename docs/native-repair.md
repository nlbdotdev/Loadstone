# Repairing an installed native setup

**My library → Repair native setup** imports the exact `.loadstone` recipe used by that registration and opens the guided source selections in Discover. Repair keeps the registered version, folder, profile and library ID. It does not update to a different recipe or version. Keep MO2, games and script extenders closed throughout review and repair.

Select owned games, prepared prerequisites and original archives again. Sources are not retained in the library registry. Downloads follow the same original-source, cache, hash and Nexus membership rules as installation. Select a trusted local archive reader when required. The current implementation revalidates all declared source inputs, including archives for outputs already present; it does not yet resolve only the sources needed for damaged files.

## Review and confirmation

Review hashes recipe outputs and shows matching, missing and changed files. Matching files are reused without rewriting them. Missing files are reconstructed. Changed game/mod files are moved to a unique `.loadstone-repair-recovery/<id>/` folder before replacements are written; an existing retained copy is never overwritten. Changed files, roots or metadata after review require another review.

By default, existing changed profiles and configuration are preserved. This includes `profiles/`, `overwrite/`, `downloads/`, and files ending in `.ini`, `.json`, `.toml`, `.yaml`, `.yml`, `.cfg`, `.conf`, `.fos`, `.ess`, `.nvse`, `.skse`, `.f4se` or `.bak`. Review displays the number of changed personal files retained and up to 20 paths. Missing recipe configuration is restored because no existing file is being replaced. Saves cannot be recipe outputs; untracked files and save directories are not written or removed.

The separate **Restore changed profiles and configuration to this recipe too** option also restores declared profile/configuration files, retaining their previous contents before replacement. It may reset recipe mod ordering or settings. Existing `downloads/` and `overwrite/` recipe files remain preserved even with that option. This choice does not migrate/import saves, run a converter, or delete untracked content. Changing the policy invalidates the reviewed plan.

**Repair installed setup** writes a durable `repairing` library record before acquisition or candidate changes. My library shows progress and cancellation. Completion verifies replacements against recipe hashes, retained personal files against hashes captured during review, and the current launch-critical executables and isolated-profile layout. Unsafe preserved MO2/profile settings prevent completion; review again with an explicit configuration restore or correct the local settings before retrying. Completion does not launch the manager or game.

## Recovery and state

Cancellation, failed writes or process interruption retain the existing setup and all recovery copies. Library launch and shortcut creation remain disabled while repair is incomplete. **Review repair again** reselects the same package and source inputs, reviews current files afresh and continues in the same installation. A failure after retaining an original but before writing its replacement leaves both the retained original and the missing/partial replacement available for that review. Removal remains available for a stopped repair under the existing save-preserving removal policy.

Existing Desktop/Steam shortcuts start MO2 directly and cannot enforce Loadstone's repair state. Keep games and managers closed until repair finishes. No automatic rollback, recovery-folder deletion, version update or save migration is provided by this operation.

The original reconstruction receipt remains unchanged and is retained in each attempt's recovery folder. It records the original reconstruction; the library's repair record describes later maintenance. Schema-1/2 registrations migrate to schema 3 on the next successful state mutation, without eager writes. Schema 3 adds repair recovery directory, start/completion time and preserved-file count. An interrupted `repairing` record becomes `repair-failed` on restart. Unreadable/newer state and external registry edits are refused. Failed final state persistence requires restart and a fresh repair review.

The last strict recipe verification timestamp is not advanced by repair when personal files are retained. **Verify recipe files** can still report intentional local differences after successful repair. A repaired setup has passed the repair's replacement/preservation and launch-layout checks; actual gameplay/save compatibility still requires separate acceptance.

## Verification scope

Synthetic service tests cover missing/changed files, retained originals, personal files and save canaries, explicit configuration restore, redirected/stale paths, protected registry writes, active managers, cancelled work, failed replacement after retention, failed final persistence, restart/retry, schema migration and original RAR acquisition. Actual Electron exercises library-to-Discover repair review, preservation, reconstruction and restart persistence. No fixture executable is run; real game, Desktop and Steam installations remain outside these tests.

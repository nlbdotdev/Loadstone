# Troubleshooting

Begin with the operation that failed, its exact setup version and the build identity shown by the app. Preserve the failed candidate and recovery folders while investigating. Export the app's diagnostic summary when useful; inspect it before sharing and keep raw logs, private paths and account credentials private.

## A source file does not match

Check that it is the original archive and version requested by the recipe. An extracted folder, a renamed replacement or a newer upstream release is not an exact substitute. The filename is only a lead; the byte count and SHA-256 are decisive. Use the guide's verification and cancellation controls instead of bypassing the mismatch. Creators should update a recipe only after reviewing the new source and resulting outputs.

## Nexus downloads are unavailable

Check the account state and last verification in Settings. Automatic downloads require the declared access conditions, including fresh Premium verification where required. [Manual downloads](../../docs/native-manual-downloads.md) open the declared Nexus file page for normal browser interaction, then validate the selected original locally. A missing or removed upstream file remains a source problem; the app does not invent a mirror or bypass website controls.

## The build was interrupted

Use the [resume review](../../docs/native-build-recovery.md). Matching files can be reused, while conflicting files are retained before reconstruction. A receipt is not proof that a partially written directory is complete. For a registered setup with an interrupted repair, follow the fresh repair review before trying to launch.

## Verification reports differences

Distinguish an intentional configuration edit from a missing or damaged static output. [Same-version repair](../../docs/native-repair.md) preserves existing profiles/configuration by default and keeps replaced originals. Choose configuration restoration only when you intend to return to recipe settings. If a source no longer verifies, repair cannot safely replace it with another version.

## Steam is running when I create a shortcut

Follow the app's running-client safeguard and close Steam normally before retrying a shortcut write. Steam can rewrite its shortcut database while running. Shortcut creation is separate from launching a game or proving its Steam startup requirements. See [library and shortcut guidance](../../docs/native-library.md).

## Steam load error or a game that will not start

Check the recipe's owned edition, game folder, manager executable, profile and declared Steam app ID. The [Steam startup notes](../../docs/native-library.md#steam-game-startup) record a case resolved after a normal Steam restart. Do not treat repeated automated menu input as a gameplay test. Once launch works, use an appropriate disposable new game and verify save/reload separately.

## A container cannot be inspected

Confirm that the selected trusted archive tool is supported and that the original is complete. BSA inspection currently accepts a bounded subset of version 104. A rejected variant is not necessarily a corrupt game archive. Review [archive comparison limits](../../docs/installed-inventory.md) and [BSA limits](../../docs/bsa-inspection.md). Keep an unresolved issue explicit; do not accept partial matches from an unsafe container.

## Removal retained a folder

This can be expected. Saves, configuration, modified files and untracked content may remain in recovery. Read the removal review and [recovery rules](../../docs/native-maintenance.md) before deleting anything manually. A retained folder is not a reason to retry a recursive deletion.

## Reporting a problem

Include the Loadstone build/version, Windows version, operation, setup identity and the smallest reproducible sequence. Use synthetic inputs for a public reproduction where possible. Follow [security reporting](../../SECURITY.md) for sensitive findings and [privacy guidance](../../docs/privacy.md) for diagnostic exports.

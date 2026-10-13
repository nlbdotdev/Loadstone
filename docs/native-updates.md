# Native version updates

**My library → Install another version** selects a local `.loadstone` package for the same setup ID, game and game variant as the installed registration. Its version label must differ. Loadstone does not infer ordering from arbitrary version labels, discover releases online or authenticate a publisher from a matching setup ID; obtain the package from a creator you trust.

The update builds a **separate installation**. The original folder, library entry, personal settings, mods, saves and shortcuts remain available. The selected recipe supplies fresh settings and an isolated profile for the new version. No personal content or saves are migrated, even when the creator declares save compatibility. Review the new package's explicit `compatible`, `unknown` or `new-save-required` guidance before considering any later manual transfer.

1. Select the other version from the installed entry. Same-version packages belong in [Repair native setup](native-repair.md). Incomplete repairs/removals cannot start this workflow.
2. Review both version labels and the original folder in Discover. Choose required owned games, prepared prerequisites and original archives using the [guided installer](native-guided-install.md). The original setup's parent is suggested; another ordinary local parent can be selected.
3. **Review installation** chooses a new child folder and shows the complete fresh-install storage and download requirements. A destination inside, equal to or containing the original folder is refused. Existing installed folders also retain the builder's protected-root checks.
4. **Install separate version** starts the existing acquisition, reconstruction and final-file verification pipeline. Downloads supports cancellation and same-package resume. A failed or interrupted new candidate does not change the old registration or redirect its shortcuts.
5. After file verification, **Review for My library** verifies the new candidate's full recipe and portable launch layout, then separately confirms admission. The two versions have independent IDs and shortcut ownership. No game is started. Keep the original until you have independently accepted the new version; either registered version can use the existing save-preserving removal workflow.

Selection/review/confirmation recheck the original registration, recipe, receipt and directory identity. Changed registry state, replaced/redirected roots, different setup identity and a manager session launched by Loadstone prevent confirmation. Existing personal file changes are allowed because the old installation is never reconstructed by this operation. The new package must still match its imported recipe hash, and all new inputs and outputs must pass the normal builder checks.

## Recovery and limits

The old-version comparison is temporary local draft state; it is discarded on restart. Durable history records the new candidate as an ordinary independent build. **Review resume** uses that candidate's exact recipe and destination and reselects its sources; it does not re-open or alter the original version. There is no persistent parent-child relationship between the two entries, automatic switch, in-place update, delta patch, setting merge or save migration. No new state schema is introduced.

This workflow offers a recoverable fresh-install update, not verified game/save compatibility. Synthetic service and actual Electron tests check preservation, failure/cancellation/restart, exact identity constraints and independent library admission. Real version-to-version gameplay, clean-machine, provider and Steam-client acceptance remain required.

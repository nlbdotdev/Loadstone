# Resuming native candidate builds

Downloads offers **Review resume** for failed, cancelled and interrupted builds. Select the same `.loadstone` package and reselect its inputs through the [guided installer](native-guided-install.md), plus a trusted local archive tool when required. The creator path in Settings → Reconstruct a local candidate still accepts a private local-inputs JSON. Source paths and credentials are not saved in build history. The existing history record fixes the destination; the renderer cannot substitute another folder.

Keep MO2, supported games, script extenders and Wabbajack closed. Resume checks this before review, before acquisition and again before reconstruction. The candidate cannot overlap a registered native setup, another build, source inputs, app data or protected application/system folders. Completed library installations use separate maintenance controls; build resume is not an update or repair operation for an active playthrough.

## Review and confirmation

Review checks the recipe fingerprint and reconstruction metadata, scans the ordinary candidate tree and hashes existing outputs against their static or generated expectations. It reports matching files to reuse, missing files to build and conflicting files to preserve before rebuilding. Generated MO2 configuration is compared against the exact destination-specific bytes. Dismissing or cancelling the review changes no candidate files. Review progress is measured and cancellable; it is not persisted as an active build.

**Resume candidate** is explicit confirmation to reconstruct the same recipe. All required source inputs and archive structure are verified again before candidate writes. Existing reviewed file identities and timestamps, metadata fingerprints and the root identity must still match. Changed or replaced files after review stop recovery and require a fresh review. Existing matching outputs are left in place and included in final verification; only missing or conflicting outputs are written.

Conflicting files are moved, without replacement or deletion, into a unique folder below `<candidate>/.loadstone-build-recovery/`, retaining their relative paths. The previous reconstruction receipt is copied there too. Output creation remains exclusive. This preserves modified profile/configuration files as copies while restoring the recipe version in the candidate; review these copies before manually carrying settings into another version. Untracked files and saves remain in place. Recipes cannot target `.loadstone*` paths or save directories.

Only Loadstone opens destination paths; archive tools emit bytes to the existing bounded readers. ZIP, 7z and RAR reuse the same source and extraction validation as a new build. Verified cached downloads are reused. Interrupted partial downloads still restart from the beginning; this feature resumes candidate files, not byte ranges in downloads.

## Failures and restarts

Cancellation or failed writes retain the candidate and all recovery copies. Files already reconstructed remain available for the next review. A crash after retaining a conflict but before writing its replacement leaves the retained copy and a missing output; a later review rebuilds that output without deleting the copy. No automatic rollback, recovery-folder deletion or save migration occurs.

The same history entry records the resumed attempt. Restart converts active history into `interrupted` without continuing reconstruction. A failure before a candidate directory exists can retry that reviewed destination; a directory appearing after review is refused. A hard kill before both initial recipe and receipt metadata exist cannot establish the partial folder's provenance: preserve it and create a new candidate instead. Missing, corrupt or incompatible metadata is not guessed or repaired.

History remains schema 1, with no saved source map or recovery plan. External history changes or failed persistence stop new work and require restart. `materializing`, `failed`, `cancelled` and `verified` receipts can be reviewed for a failed/interrupted history entry; this handles a crash after final verification but before history was saved. Successful resume still says **Files verified · Launch untested** and does not register, launch or create shortcuts automatically.

Destination free-space checks count outputs still needing reconstruction plus recipe metadata and the normal reserve. Existing matching outputs and retained same-volume copies are not charged as a complete second installation. All final outputs are rehashed before success. These checks supplement Windows access controls; they are not a sandbox against an actively hostile process racing filesystem changes.

This workflow is available through the desktop builder. The local CLI still requires a new destination. Native library updates, clean-machine install-to-play, game/save compatibility and actual Steam-client acceptance remain separate work.

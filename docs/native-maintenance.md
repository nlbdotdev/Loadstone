# Native removal and recovery

**My library → Remove native setup** reviews a registered candidate before showing a native confirmation dialog. Keep supported games, script extenders, MO2 and Wabbajack closed. The process check must succeed before review and again before removal. No game or manager is started by this workflow.

The review scans the ordinary candidate tree and compares potentially removable files with recipe sizes and SHA-256 hashes. It reports the maximum reviewed file count/bytes, retained file count and exact recovery path. Cancelling this review or its confirmation changes no candidate files.

## What is kept

Only static recipe outputs whose current bytes match the recipe may be selected for deletion. Everything else is retained, including untracked files and modified recipe outputs. The following are always retained even when they match the recipe:

- All content under `profiles`, `overwrite` and `downloads`, and any directory named `saves`.
- Configuration files ending in `.ini`, `.json`, `.toml`, `.yaml`, `.yml`, `.cfg` or `.conf`.
- Save/co-save/backup files ending in `.fos`, `.ess`, `.nvse`, `.skse`, `.f4se` or `.bak`.
- `.loadstone*` metadata. The generated MO2 configuration is retained.

After confirmation, Loadstone durably records `removing`, rechecks the root identity and protected locations, then moves the entire candidate into a sibling folder named `<candidate>.loadstone-recovery-<registration-id>`. It never replaces an existing recovery folder. It rehashes each selected file and checks that its identity and timestamps still match the review before unlinking it. Edited or replaced files are kept, including same-byte replacements with a different identity. Newly created files are never added to an existing removal plan. Only empty ancestor directories of deleted files are cleaned up; the recovery root remains.

The recovery folder is retained data, not a playable installation. Its manager configuration still describes the original destination. Do not launch it directly or copy saves into another version without checking that version's save guidance. Removing a setup does not delete a source game, archive cache outside the candidate, global save folder or another registered setup.

## Interruptions and shortcuts

**Stop removal** stops further work after the current asynchronous operation observes cancellation. Files already deleted are not restored. Remaining content stays in the original or recovery folder, and the entry offers **Resume native removal**. Resuming requires a fresh review and confirmation; missing files are skipped and remaining files are checked again. A restart converts durable `removing` state into an interrupted state without automatically continuing deletion.

Redirected entries, replaced roots, changed reconstruction metadata, protected-folder overlap, a conflicting recovery folder or an unavailable state file stop the operation. Preserve the directories and registry when resolving such a conflict. No broad recursive deletion is used. A failed registry write before the initial move leaves the candidate in place; a later failure leaves a resumable durable record.

After file removal, Loadstone removes only its identified Desktop and Steam shortcuts. Steam must be completely closed to edit its shortcut file. Cleanup failures remain visible and **Clean up native shortcuts** retries them without rerunning file removal. Existing Steam backups and unrelated entries remain intact.

Native library state is now schema 2. Schema-1 registrations migrate in memory without an eager disk write and are saved as schema 2 on the next successful mutation. Older builds reject the newer state; preserve app data before downgrading. Removed entries remain as recovery records; there is no automatic recovery-folder deletion or history pruning.

[Native library repair](native-repair.md) now has its own reviewed reconstruction and retained-copy workflow. Stopped repairs may also use this removal policy. Version updates and save migration remain separate work. [Interrupted candidate builds have their own resume review](native-build-recovery.md). Synthetic and actual-Electron tests prove the controlled removal/recovery behavior, not real gameplay, save compatibility or Steam-client acceptance.

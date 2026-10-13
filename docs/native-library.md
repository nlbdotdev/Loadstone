# Native candidate library

In the live workspace, **My library → Add native candidate** selects a completed reconstruction folder, including a candidate built by the CLI. Keep MO2 and the game closed while reviewing or verifying it. Loadstone reads its recipe and reconstruction receipt, verifies every static output against its byte count and SHA-256, and checks the generated portable MO2 configuration. Progress is measured in recipe outputs; verification can be cancelled without changing candidate files.

The review shows the selected folder, profile, output count and the recipe author's save guidance. **Add to library** registers that reviewed candidate without starting a process or creating shortcuts. Only register a creator's executable content if you trust it: recipe fingerprints establish consistency, not safety or authorship. Reconstruction and file verification do not certify gameplay. The existing build history remains separate, and completing a build does not automatically register it.

## Admission and launch checks

- The recipe fingerprint must match a completed `verified` receipt. Its generated configuration fingerprint must match the selected destination. Copied candidates need a fresh reconstruction for their new paths.
- The current implementation requires the native `mo2-config` generator, an empty portable marker, the declared profile, and an isolated game directory. Static imported manager configuration is not supported for registration.
- MO2's base, mods, downloads, profiles, overwrite and cache paths must stay in their declared local directories. The selected launch entry must retain its declared title, binary, working directory and arguments. Duplicate INI sections/keys (including case variants), percent-encoded section/key names and ambiguous launch titles are rejected. MO2 may change unrelated window/UI values in supported sections.
- The selected profile's `settings.ini` must explicitly declare `[General]` `LocalSaves=true` and `LocalSettings=true`. Global defaults alone are insufficient. An existing local saves directory must not be redirected. Loadstone never imports an existing playthrough.
- The manager, selected launch executable and base game executable must match recipe hashes and have Windows executable headers. Directories and checked files must be ordinary, unredirected paths. Registration retains the root directory's identity, so replacement or redirection is rejected.

**Launch native setup** repeats the recipe/receipt, executable, path and local-profile checks before opening MO2 with the exact declared profile and launch title. It tracks the manager process started by Loadstone; a manager window opening or closing is not evidence that the game started or exited. **Verify recipe files** separately repeats the complete static-file comparison and records the latest successful verification time. Later user edits may cause this comparison to fail; no file is repaired, overwritten or removed.

The full comparison is a point-in-time result. Registration rechecks metadata and the launch-critical files after review; launching does not rehash every mod file. Close other MO2/game windows yourself, including windows started outside Loadstone.

## Shortcuts and local state

Desktop and Steam buttons create or repair shortcuts to the candidate's manager and exact profile. Creation checks the same launch layout. Desktop links use the registered candidate ID as an ownership marker. Steam preserves unrelated entries and existing owned app IDs, backs up its shortcut file, and requires Steam to be completely closed. Choose the intended local account before saving.

These shortcuts start MO2 directly. They do not run Loadstone's checks again when clicked; use the library's launch button to recheck the current layout. Actual Steam-client/gameplay acceptance remains outstanding.

`native-library.json` in app data stores up to 100 registrations: local path and directory identity, recipe hash, title/version/profile, save guidance, output count and verification time. It contains no Nexus key or source archives. Writes preserve the previous registry if replacement fails, and refuse externally changed or unsupported state. Restart restores registrations without verifying or launching candidates automatically. Native verification prevents closing Loadstone until it finishes or cancellation completes.

Native repair, update, library removal, automatic shortcut cleanup and save migration are still unfinished. This feature does not claim ownership of a selected candidate's files for deletion. Wabbajack removal controls apply only to Wabbajack jobs. Real install-to-play acceptance and pack publication remain separate gates.

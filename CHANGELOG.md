# Changelog

## 0.4.0 — native installation preview

- Guided `.loadstone` installation in Discover: select owned games and local prerequisites, review destination and sources, then follow measured progress in Downloads.
- Original HTTPS and Nexus archive acquisition, verified cache reuse, browser handoff for manual Nexus downloads and cancellable local-file verification. Real provider/account acceptance remains required.
- ZIP/7z/RAR reconstruction, destination-bound MO2 configuration and expanded installed-baseline inventories and source mapping. 7z/RAR operations require an operator-supplied trusted 7-Zip tool; it is not bundled.
- Resume interrupted builds, explicitly admit verified candidates to My library, and create Desktop/Steam shortcuts for isolated profiles.
- Same-version repair with retained originals and configuration preservation; separate-folder version updates; reviewed removal retaining saves and user changes. Each workflow includes interruption/recovery checks.

- Adopt GPL-3.0-or-later for Loadstone's original source, with the full license, explicit scope and contribution terms. New packages and the About screen include the license offline; third-party notices remain intact.
- Recognize archive contents independently of cached filenames, preserving original names and bytes. ZIP reconstruction and ZIP/7z/RAR source comparison retain full hash and structural checks.
- Allow large members in the verified single-pass 7z mapper within its existing 20 GB total stream limit.

This is an unsigned private Windows preview. No playable featured pack is bundled. Fixture tests and the private full-size TTW file comparison do not certify gameplay, real Nexus downloads or Steam-client behavior. Public registration, clean Windows install-to-play, featured-pack source/rights completion, publication review and final release materials remain open. The older 0.3.0 executable and video retain their original provenance.

## 0.3.0 — native creator preview

- Documented experimental `.loadstone` format, strict validator, deterministic compiler and bounded package inspection.
- Read-only installed MO2 inventories, private source ledgers and exact ZIP/7z/RAR member comparison. Eligible solid 7z archives are checked in one bounded stream.
- Native reconstruction from owned games, locked local prerequisites, original ZIP archives and reviewed bundled payloads into a fresh directory.
- Settings package preview and a local candidate workflow with review, cancellation, final output hashing, durable history and explicit interrupted-build handling.
- Windows state-write retries and a corrected ASAR verification fixture that waits for archive writing to finish.

This is an unsigned local creator preview, not 1.0 or a public release. Native builds require a prepared private inputs JSON. Native source downloads, 7z/RAR reconstruction, configuration rebasing, partial-build repair and native launch/shortcuts are unfinished. TTW conversion and the three featured lists have not passed installation, gameplay or publication acceptance. Licensing, Nexus registration and Steam-client gates remain open. Existing game installations and saves are preserved.

## 0.2.0 — local developer preview

Implemented since the demo-only 0.1.0 release:

- Explicit live/demo onboarding and settings migration with persistence safeguards.
- Creator manifest import, game discovery, archive/game hashes and storage preflight.
- Pinned Wabbajack preparation and integrity checks; protected local Nexus connection for private testing.
- Durable installation jobs, cancellation/retry, output verification and MO2 profile launch.
- Desktop/Steam shortcut creation, repair and owned-entry cleanup; versioned fresh installs and save-preserving removal.
- Creator-declared isolated game-layout validation and protection against closing during active file operations.
- Privacy-conscious diagnostics, generated dependency notices, publication audit tools and a separate Steam depot preview workflow.

Remaining limits: no bundled playable catalog; automatic Nexus downloads require Premium; public Nexus registration and the project license are undecided; VNV needs compatible game preparation; full authenticated install-to-play, clean Windows/Steam and save-preservation acceptance remain incomplete. Native third-party logs can remain unsanitized during a run or after a crash. Builds are unsigned. No new hosted release or Steam submission is implied by this version.

## 0.1.0 — historical private UI preview

Svelte/Electron visual prototype with a fictional catalog, simulated installation/library workflow, native preferences and a portable Windows build. It predates live installation support.

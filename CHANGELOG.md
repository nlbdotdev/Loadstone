# Changelog

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

# Reviewing the 0.3.0 native creator preview

This build includes the live installer and maintenance features developed after the original demo. It is unsigned and remains a private developer preview. A real supported install-to-play run, clean Windows/Steam acceptance, Nexus registration and project licensing are still required before public release.

## Walkthrough

1. Start with a fresh test workspace. The welcome screen offers live setup or the fictional demo; neither starts a download automatically.
2. Explore the demo: Discover filters/details, install planning, Downloads pause/cancel/retry, Library actions, settings persistence and reduced motion. Demo activity must remain separate from live state.
3. In the live workspace, prepare the pinned engine in Settings and import a compatible creator manifest/archive. Check the game and destination. Failed compatibility or account checks must prevent installation.
4. Connect Nexus only through Settings in your local app. Do not put keys in chat, manifests or reports. Lists requiring automatic Nexus downloads currently need Premium, and a conflicting saved Wabbajack login must be resolved in that application.
5. With an accepted real list, exercise download/install, failure/retry, output verification, profile launch, shortcut repair, version coexistence and save-preserving removal. These are required acceptance steps, not a claim that they have already passed.
6. Export diagnostics and confirm build identity. Ordinary closes during installation, removal or engine preparation should keep the operation visible and offer minimization. Idle closes should exit cleanly.
7. In Settings, inspect a native package, then reconstruct a synthetic local candidate with the matching private inputs JSON. Confirm the new destination and prerequisite summary before starting. Check cancellation, restart history and **Files verified · Launch untested**; candidates must stay out of the playable library. Use fixtures outside real game, Desktop and Steam folders.

The existing VNV archive needs additional game preparation. Read [the real preflight findings](vnv-acceptance.md) before using it as an acceptance candidate. An isolated-layout declaration does not convert an archive into a Stock Game list.

## Reproduce package verification

Run `pnpm check`, `pnpm test`, then `pnpm package` from a clean commit. Set `LOADSTONE_TEST_EXE` to `release/win-unpacked/Loadstone.exe` and run the Electron, live, Nexus, onboarding, close-guard, native-preview and native-builder tests. Clear that environment variable, then run `node scripts/verify-portable.mjs` to exercise the actual self-extracting executable. The script derives its filename/version from package metadata and records the artifact's SHA-256, size and checked workflows under ignored `test-results/`.

Use a dedicated `LOADSTONE_DATA_DIR` for manual review. This isolates settings and credentials, but does not redirect Desktop or Steam operations. Automated shortcut tests use explicit temporary targets. Do not point a test workspace at data you need to preserve.

The original [0.1.0 review](review-0.1.md) is historical evidence for the demo-only release. Its screenshots and claims do not certify the newer live installation features. See [Steam depot verification](steam-release.md) for the separate directory build and actual-client acceptance requirements.

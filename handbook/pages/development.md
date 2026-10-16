# Development guide

The desktop app uses Svelte 5, TypeScript, Vite and Electron. Native installation and packaging target Windows x64. The handbook is a separate static Svelte application using the same locked toolchain; its build is not included in the desktop bundle.

## Set up the repository

Use Node.js 22 or later and pnpm 11 or later. Install the committed lockfile, then run diagnostics and the application:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm start
```

Do not point development or test state at a real playthrough. Automated fixtures use temporary directories. `LOADSTONE_DATA_DIR` isolates app state, but does not redirect Desktop or Steam integration by itself.

## Find the implementation

| Area | Entry point |
| --- | --- |
| Desktop UI | `src/App.svelte`, native workflow components and `src/styles.css` |
| Shared brand | `public/brand/mark.svg`, consumed by `src/Logo.svelte` and asset generators |
| Process boundary | `electron/main.cjs` and `electron/preload.cjs` |
| Demo state | `electron/store.cjs` |
| Native recipe validation | `electron/native-format.cjs` |
| Package inspection | `electron/native-package.cjs` |
| Reconstruction | `electron/native-materializer.cjs` and archive/BSA adapters |
| Creator evidence | `electron/installed-inventory.cjs`, `source-ledger.cjs`, `archive-mapping.cjs`, `bsa-mapping.cjs` |
| Handbook | `handbook/`, its source catalog and `scripts/handbook.mjs` |
| Verification | `tests/`, including actual Electron workflows |

Keep filesystem access, credentials and process creation in the main process. The renderer receives a limited typed bridge. Validate IPC arguments and preserve unrelated files throughout failure and recovery paths.

## Run checks

```powershell
pnpm check
pnpm test
pnpm handbook:check
pnpm handbook:test
git diff --check
```

Some archive tests require a trusted 7-Zip executable selected through `LOADSTONE_TEST_7ZIP`; CI prepares a pinned tool. An optional external-runtime test may skip without its prerequisite. Report skips and real acceptance gaps explicitly. For a native behavior change, use the relevant actual Electron path as well as unit fixtures.

## Build artifacts

`pnpm package` prepares the unsigned portable Windows preview. `pnpm package:steam` prepares a separate unpacked Steam depot preview. Both rely on generated notices and build provenance. They do not upload a release. Read [preview packaging](../../docs/private-preview.md) and [Steam packaging](../../docs/steam-release.md) before handing off an artifact.

## Finish a change

Keep the implementation, regression coverage and canonical documentation together. Regenerate the handbook agent edition with `pnpm handbook:sync`. Review public files and media for private information, then use the contribution/PR workflow. A code merge does not certify a public stable release or approve publishing a setup.

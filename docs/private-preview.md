# Private Windows preview packaging

Version 0.4.0 brings guided native installation and maintenance into an unsigned Windows x64 preview. A local package is not publication or 1.0 acceptance. Preserve the recorded 0.3.0 executable and footage. Build from a clean committed source revision; never label an older artifact with current-source capabilities.

## Build and exercise the artifact

Use Node 24 and pnpm 11 on Windows. Install the locked dependencies, run `pnpm check` and `pnpm test`, then `pnpm notices`. Review and commit any intended notice changes before the final package build. For complete archive coverage, supply `LOADSTONE_TEST_7ZIP` with the trusted tool prepared by `scripts/prepare-sevenzip.ps1`.

Choose a new ignored output folder for each build. With `release/private-0.4.0` still absent:

```powershell
pnpm package --config.directories.output=release/private-0.4.0
node scripts/steam-depot.mjs release/private-0.4.0/win-unpacked
```

The depot script creates a fresh `release/steam/preview-<id>` containing the entire application, notices, integrity manifest and SteamPipe templates. Verify it with `node scripts/steam-depot.mjs --verify <kit-directory>`. Check its embedded commit, `dirty: false`, version, license, lockfile hash and notice gaps. No command uploads a depot.

Set `LOADSTONE_TEST_EXE` to the absolute path of that kit's `content/Loadstone.exe`, then run the staged-executable test selection from `.github/workflows/windows.yml`. These tests redirect native side effects to synthetic fixtures; `LOADSTONE_DATA_DIR` alone does not redirect Desktop or Steam operations. Clear `LOADSTONE_TEST_EXE` afterwards.

```powershell
node scripts/verify-portable.mjs release/private-0.4.0 test-results/private-0.4.0
```

This separately exercises the actual portable wrapper, including extraction, current version, renderer/bridge, complete offline GPL and scope texts, settings, demo isolation and clean shutdown. Inspect its screenshots and JSON evidence. Preserve its SHA-256 and size along with the unpacked depot inventory. Neither check certifies real games, real accounts or the actual Steam client.

## Exact source and review material

Read the **embedded build commit** from the verified depot manifest. From the source repository, use that exact commit, not a subsequently merged branch tip:

```powershell
git archive --format=zip --prefix=Loadstone-source/ --output=release/private-0.4.0/Loadstone-0.4.0-source.zip <embedded-build-commit>
```

The archive must contain all tracked build inputs, including original source, lockfile, scripts, tests, license/scope, notices and documentation. Inspect the ZIP inventory against that Git tree. Exclude Git history, installed dependency trees, raw acceptance evidence, credentials, game files and mod downloads. Record its SHA-256 and byte size; independently compare the packaged source modules, license and notices with the archived revision. Rebuild from an extracted source archive with `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test` and `pnpm package`; without Git metadata the build identity deliberately reports an unknown commit.

Keep a local review manifest linking the executable and source ZIP hashes, exact build commit/tree and lockfile hash, depot inventory, test evidence and tool versions. Hashes establish integrity and provenance, not byte-reproducibility, publication clearance or a legal determination. Build/test dependencies are fetched from the locked upstream graph; they are not bundled in this source ZIP. Artwork and third-party material retain the scope stated in `COPYRIGHT` and the [provenance inventory](open-source.md).

Before distribution, choose a corresponding-source delivery method that gives every binary recipient access to the matching source, finish the publication/license review and ensure the public links are usable. Preparing a private archive does not satisfy public delivery. See the [open-source gates](open-source.md) and [1.0 acceptance plan](1.0-plan.md). Public upload, repository visibility changes and Steam publication remain separate actions.

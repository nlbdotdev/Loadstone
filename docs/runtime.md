# Wabbajack runtime integration

Loadstone downloads the unmodified official Windows [Wabbajack 4.2.3.0 release](https://github.com/wabbajack-tools/wabbajack/releases/tag/4.2.3.0) into its own workspace. The package is streamed to a staging directory, checked against the release asset size and published SHA-256 digest, then extracted with path, symlink, duplicate, entry count and expanded-size limits. Only a successful CLI version and install-interface check activates the runtime. Repair keeps the previous engine in a backup directory. Cancellation discards the staging work without replacing an existing engine; interrupted app exits may leave inactive stage directories for later cleanup.

Archive SHA-256: `91392832f4466420a02687fa6e92192897e8e4b5b1b3dc97fbe36f7a4e490ba5`.

The full extracted file inventory is pinned as well, so editing inventory metadata cannot authorize changed runtime binaries. Verification rejects changed, missing, injected, or symbolic-link runtime files. The pinned CLI writes rotating logs relative to its executable despite a separate working directory. Only regular, singly linked files matching `logs/wabbajack-cli.current.log` or its numbered archives are excluded from payload hashes; other files in `logs` are still rejected. Completed installer runs sanitize these runtime logs as well as owned working-directory logs. No arbitrary executable path is accepted through the renderer bridge. At least 1.2 GB of free workspace-drive space is required while preparing the runtime.

## Verification

Run the actual released engine without downloading it during the normal offline test suite:

```powershell
$env:LOADSTONE_TEST_RUNTIME_ARCHIVE = 'C:\path\to\4.2.3.0.zip'
node --test tests/runtime.test.mjs
Remove-Item Env:\LOADSTONE_TEST_RUNTIME_ARCHIVE
node scripts/verify-runtime.mjs 'C:\path\to\4.2.3.0.zip'
```

This invokes the genuine released CLI, checks its installation flags, verifies all 1,085 extracted files, and tests changed/injected-file rejection. The normal suite covers duplicate and symlink rejection, cancellation, and failed-download preservation without external network access.

## Authentication and installation work remaining

The released [install command](https://github.com/wabbajack-tools/wabbajack/blob/4.2.3.0/Wabbajack.CLI/Verbs/Install.cs) supports local archives and output/download folders. It discovers the game independently; it does not accept our manually selected game path. The adapter must confirm the engine's actual game location before installation, rather than assuming the paths agree.

The released [Nexus client](https://github.com/wabbajack-tools/wabbajack/blob/4.2.3.0/Wabbajack.Networking.NexusApi/NexusApi.cs) uses an existing Wabbajack credential ahead of its `NEXUS_API_KEY` environment fallback. Its CLI also throws on interactive interventions. Account identity, Premium download access, unsupported manual-download sources and intervention/recovery behavior remain explicit integration gates. Loadstone does not yet read, overwrite, export, or modify Wabbajack credentials. Engine readiness alone must not make a live setup ready to install.

## Distribution

Wabbajack remains an independent, unmodified [GPL-3.0 project](https://github.com/wabbajack-tools/wabbajack/blob/4.2.3.0/LICENSE.txt). Its executable is downloaded from the upstream release, not embedded in this repository or the current Loadstone package. The runtime and its components retain their upstream licenses. Any future bundled distribution must include the applicable notices and corresponding source obligations. The pinned source tag and release link are retained here for review.

Real VNV preflight exposed the log location on a second runtime verification. The genuine-engine regression now runs game discovery, re-verifies with generated logs present, and checks that a DLL placed in the logs folder is still rejected. The pinned [CLI logging configuration](https://github.com/wabbajack-tools/wabbajack/blob/4.2.3.0/Wabbajack.CLI/Program.cs) declares the current and numbered archive names.

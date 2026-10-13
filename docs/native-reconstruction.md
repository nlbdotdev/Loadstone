# Experimental native reconstruction

The native materializer creates the exact outputs of a validated `.loadstone` recipe from local owned-game files, local prerequisites, ZIP/7z/RAR archives and permitted bundled payloads. The desktop can [acquire declared original archives](native-downloads.md), and the materializer can [generate bounded MO2 configuration](native-mo2-configuration.md) for the new destination. This is developer/creator tooling, available through the CLI and Settings. Completed candidates can be explicitly admitted to the [native library](native-library.md) for launch and shortcut controls. Reconstruction itself does not perform TTW conversion, apply arbitrary transforms, migrate all profile/tool settings or launch a game. Do not advertise a playable featured list from a fixture result.

## Desktop creator workflow

Switch to the live workspace and open Settings → Reconstruct a local candidate. Select the package, its private local-inputs JSON (described below), and an existing parent directory. Review the recipe name, output count, storage requirement and newly generated destination. **Build candidate** starts input verification and reconstruction; the renderer cannot supply a replacement path or arbitrary recipe. The main process binds the reviewed recipe fingerprint to the materializer.

If the inputs include 7z/RAR archives or request downloads, select a trusted local **7-Zip x64 26.04 or newer** `7z.exe` with its matching `7z.dll`. Downloads are conservatively prepared for any supported archive signature; a ZIP download still uses the built-in ZIP reader. The review shows the selected version. The app retains the tool identity between review and build and rejects changes. Cancelling this picker creates no job. Recipes and private-input files cannot nominate an executable; selection is through the native picker. No 7-Zip binary is bundled, automatically downloaded or installed.

Progress and cancellation remain in this Settings card. Success says **Files verified · Launch untested**. Native candidates are not automatically registered or given shortcuts; explicit library review is separate. Native builds, library verification, other installations/removal and engine preparation cannot start over one another; the close guard keeps Loadstone open until selection/build/cancellation finishes.

Active builds distinguish archive acquisition, source-file checks, archive-structure checks, writing outputs and final-file verification. The display shows completed files within the current stage and bytes in the current file, so large files can show activity before a file-count increment. Writing every output does not finish the build: final hashes must still pass. Byte updates are throttled; these are measured counts, not an overall time estimate. The local-only CLI reports materializer phase changes and bounded periodic activity without source paths. Reading/validating the package itself still precedes this phase reporting.

Phase activity exists only in memory and is absent from persisted build history and diagnostic exports. Restarted builds keep the existing interrupted-state behavior, rather than presenting stale phase progress as active work. Cancellation and failure still preserve any partial candidate.

`native-builds.json` in the local app-data folder retains up to 100 build records, including destination, recipe fingerprint, progress and status. It contains no credential, source archive paths, local-input map or raw tool output and is excluded from diagnostic exports. Invalid/newer history is preserved and refused, rather than silently reset. Active records become `interrupted` after restart without resuming work. Cancelled, failed and interrupted candidates offer [explicit recovery review](native-build-recovery.md): reselect the same recipe and inputs, reuse matching files and retain conflicts before rebuilding them. Resume updates the same history entry. Native library repair/update and build-history management remain unfinished. Failed writes or external history changes stop new work and require restart.

## Local command

```powershell
node scripts/materialize-native.mjs candidate.loadstone private-inputs.json C:\LoadstoneReview\NewCandidate
# Include this explicit operator-selected tool for 7z/RAR inputs:
node scripts/materialize-native.mjs candidate.loadstone private-inputs.json C:\LoadstoneReview\NewCandidate --sevenzip C:\Tools\7-Zip\7z.exe
```

The destination's parent must already exist; the destination itself must not. The private JSON input file has two maps: `games` maps each required game ID to its installed source folder; `archives` maps each archive source ID from the recipe to a locally downloaded ZIP, 7z or RAR file. When the recipe declares local prerequisites, add a `prerequisites` map from each prerequisite ID to its prepared source folder. All declared prerequisite files are hashed before reconstruction; the app never runs the instructions URL or a conversion program. Paths must be absolute. Keep this file under ignored `test-results/` and do not publish it. It contains no Nexus credentials or runtime command arguments.

For example, a private input file can contain:

```json
{
  "games": { "fnv": "C:/OwnedGames/Fallout New Vegas" },
  "archives": { "example-source": "C:/ModDownloads/example.zip" }
}
```

These example paths are illustrative. The executable, required game files and archives must match the actual recipe's byte lengths and SHA-256 hashes; having a folder with the expected name is insufficient. Storefront/license eligibility remains a separate release requirement.

In the desktop workflow only, an archive map value may instead be `null` to request acquisition of that recipe source. Every source ID must still appear exactly once; omitted or extra IDs are rejected. The CLI remains local-only. See [original-source downloads](native-downloads.md) for cache, network and membership behavior.

## Data preservation and verification

All requirements and archive hashes are checked before creating the installation directory. ZIP, 7z, RAR4 and RAR5 inputs are recognized by their signatures, allowing mislabeled original filenames without renaming them; signatures never replace hash or structural validation. Archive paths, links, duplicate/colliding names, encrypted/unsupported entries, required members and declared sizes are checked in advance. Available destination space must cover expected outputs, recipe metadata and a 64 MB reserve. Archive inventories are limited to 500,000 entries and 100 GB declared uncompressed content; local archives are bounded to 50 GB.

7z/RAR reconstruction uses the same validated adapter as [source comparison](installed-inventory.md). The external tool runs without a shell and emits file content to stdout; it never receives output paths. Loadstone waits for disk writes before reading more data, checks exit status and input identity, and closes the child before reporting failure or cancellation. Tool diagnostics do not enter build history. 7-Zip 26.04 with `zlib.crc32` uses one pass for eligible 7z archives with per-member CRCs and at most 20 GB total content. Every boundary, including unselected members, is CRC-checked. Up to 100,000 selected members are supported in that pass. Other versions, RAR and ineligible 7z archives read each selected member with literal selectors: at most 10,000 members and 20 GB selected content per archive. This fallback can be slow for solid archives. Single-pass extraction has a five-minute limit; fallback reads have a ten-minute limit per member. These are experimental creator limits, not general archive support guarantees.

Destinations cannot overlap selected game inputs, source archive/package folders, the selected tool directory, the application, system folders or additional protected roots supplied by the caller. Redirected directories are rejected; existing destinations require a separate bound recovery review in the desktop builder. New directory creation is exclusive; output files use exclusive creation. The materializer never modifies source game files or downloads, executes archive content or writes save paths.

Each output stream is bounded and hashed, then all final files are re-hashed before success. Static outputs use recipe fingerprints; generated MO2 configuration uses the destination-specific fingerprint computed before writing. The new directory contains `.loadstone-recipe.json` and `.loadstone-native.json`. The receipt records the recipe fingerprint, generated-configuration fingerprints when present, progress and one of `materializing`, `verified`, `failed` or `cancelled`. `verified` means reconstructed bytes matched the static or derived expectations; `launchVerified` remains false.

Cancellation or failure retains the candidate directory and receipt. A hard process kill may leave a `materializing` receipt and an incomplete file; desktop history marks the build interrupted after restart. [Resume review](native-build-recovery.md) checks retained bytes, preserves conflicting files in a unique recovery folder and revalidates every final output. The writer does not recursively delete failed setups or continue automatically after a restart.

These checks supplement standard Windows access controls; they are not a sandbox for an actively hostile process racing filesystem changes. Keep source files and the new destination settled during reconstruction.

## Acceptance remaining

Complete real provider-download acceptance, conversion, profile/tool configuration reconstruction, native library repair/update and real maintenance acceptance. Creator reconstruction is exercised through real Electron with original synthetic ZIP, solid 7z and stored RAR5 inputs, including cancellation, failed writes and tool replacement. The RAR5 fixture is generated from the [published format](https://www.rarlab.com/technote.htm), without third-party archive contents or encoder code. Clean-machine installation and gameplay acceptance remain unfinished. The separate package inspection card stays read-only.

Completed candidates with generated portable MO2 configuration may be explicitly reviewed and registered in the [native library](native-library.md). Registration adds launch and shortcut controls after file and local-profile checks. Separate [removal review and confirmation](native-maintenance.md) limits deletion to unchanged recipe files and retains user data; these controls do not certify gameplay.

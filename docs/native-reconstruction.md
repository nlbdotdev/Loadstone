# Experimental native reconstruction

The native materializer creates the exact outputs of a validated `.loadstone` recipe from local owned-game files, pre-downloaded ZIP archives and permitted bundled payloads. This is developer/creator tooling, available through the CLI and Settings, separate from the playable library. It does not yet download sources, reconstruct from 7z/RAR, perform TTW conversion, apply transforms, rebase MO2 configuration, launch a game or create shortcuts. Do not advertise a playable featured list from a fixture result.

## Desktop creator workflow

Switch to the live workspace and open Settings → Reconstruct a local candidate. Select the package, its private local-inputs JSON (described below), and an existing parent directory. Review the recipe name, output count, storage requirement and newly generated destination. **Build candidate** starts input verification and reconstruction; the renderer cannot supply a replacement path or arbitrary recipe. The main process binds the reviewed recipe fingerprint to the materializer.

Progress and cancellation remain in this Settings card. Success says **Files verified · Launch untested**. Native candidates are not added to the playable library or given shortcuts. Native builds, other installations/removal and engine preparation cannot start over one another; the close guard keeps Loadstone open until selection/build/cancellation finishes.

`native-builds.json` in the local app-data folder retains up to 100 build records, including destination, recipe fingerprint, progress and status. It contains no credential, source archive paths, local-input map or raw tool output and is excluded from diagnostic exports. Invalid/newer history is preserved and refused, rather than silently reset. Active records become `interrupted` after restart without resuming work. Cancelled, failed and interrupted candidates remain on disk; prepare a new build to retry into a new directory. Automatic resume/repair and build-history management remain unfinished. A failed history write stops the operation and requires restart for recovery.

## Local command

```powershell
node scripts/materialize-native.mjs candidate.loadstone private-inputs.json C:\LoadstoneReview\NewCandidate
```

The destination's parent must already exist; the destination itself must not. The private JSON input file has two maps: `games` maps each required game ID to its installed source folder; `archives` maps each archive source ID from the recipe to a locally downloaded ZIP file. When the recipe declares local prerequisites, add a `prerequisites` map from each prerequisite ID to its prepared source folder. All declared prerequisite files are hashed before reconstruction; the app never runs the instructions URL or a conversion program. Paths must be absolute. Keep this file under ignored `test-results/` and do not publish it. It contains no Nexus credentials or runtime command arguments.

For example, a private input file can contain:

```json
{
  "games": { "fnv": "C:/OwnedGames/Fallout New Vegas" },
  "archives": { "example-source": "C:/ModDownloads/example.zip" }
}
```

These example paths are illustrative. The executable, required game files and archives must match the actual recipe's byte lengths and SHA-256 hashes; having a folder with the expected name is insufficient. Storefront/license eligibility remains a separate release requirement.

## Data preservation and verification

All requirements and archive hashes are checked before creating the installation directory. ZIP paths, links, duplicate/colliding names, encrypted/unsupported entries, required members and declared sizes are checked in advance. Available destination space must cover expected outputs, recipe metadata and a 64 MB reserve. Archive limits are 500,000 entries and 100 GB declared uncompressed content; local ZIP inputs are bounded to 50 GB.

Destinations cannot overlap selected game inputs, source archive/package folders, the application, system folders or additional protected roots supplied by the caller. Redirected directories and existing destinations are rejected. Directory creation is exclusive; output files use exclusive creation. The materializer never modifies source game files or downloads, executes archive content or writes save paths.

Each output stream is bounded and hashed, then all final files are re-hashed before success. The new directory contains `.loadstone-recipe.json` and `.loadstone-native.json`. The receipt records the recipe fingerprint, progress and one of `materializing`, `verified`, `failed` or `cancelled`. `verified` means reconstructed bytes matched the recipe; `launchVerified` remains false.

Cancellation or failure retains the newly created directory and receipt for diagnosis. An existing or partial destination cannot be reused automatically. The writer does not recursively delete failed setups. A hard process kill may leave a `materializing` receipt and an incomplete file; automatic resume/repair is not implemented. Desktop history marks such a build interrupted after restart.

These checks supplement standard Windows access controls; they are not a sandbox for an actively hostile process racing filesystem changes. Keep source files and the new destination settled during reconstruction.

## Acceptance remaining

Integrate source resolution/downloads, local prerequisites/conversion, supported archive formats, typed configuration transforms, partial-build repair and ownership-aware maintenance. Creator reconstruction is exercised through real Electron; clean-machine installation and gameplay acceptance remain unfinished. The separate package inspection card stays read-only.

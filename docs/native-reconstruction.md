# Experimental native reconstruction

The native materializer creates the exact outputs of a validated `.loadstone` recipe from local owned-game files, pre-downloaded ZIP archives and permitted bundled payloads. This is developer/creator tooling, separate from the desktop installation queue. It does not yet download sources, support 7z/RAR, perform TTW conversion, apply transforms, rebase MO2 configuration, launch a game or create shortcuts. Do not advertise a playable featured list from a fixture result.

## Local command

```powershell
node scripts/materialize-native.mjs candidate.loadstone private-inputs.json C:\LoadstoneReview\NewCandidate
```

The destination's parent must already exist; the destination itself must not. The private JSON input file has two maps: `games` maps each required game ID to its installed source folder; `archives` maps each archive source ID from the recipe to a locally downloaded ZIP file. Paths must be absolute. Keep this file under ignored `test-results/` and do not publish it. It contains no Nexus credentials or runtime command arguments.

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

Cancellation or failure retains the newly created directory and receipt for diagnosis. An existing or partial destination cannot be reused automatically. The writer does not recursively delete failed setups. A hard process kill may leave a `materializing` receipt and an incomplete file; automatic resume/repair is not implemented. A later integration with durable desktop jobs must handle this explicitly.

These checks supplement standard Windows access controls; they are not a sandbox for an actively hostile process racing filesystem changes. Keep source files and the new destination settled during reconstruction.

## Acceptance remaining

Integrate source resolution/downloads, local prerequisites/conversion, supported archive formats, typed configuration transforms, durable jobs/recovery and ownership-aware maintenance. Add a real Electron installation workflow and clean-machine gameplay verification. The existing Settings preview remains read-only until those paths are ready.

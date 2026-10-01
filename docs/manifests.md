# Live setup manifests

Discover in live mode supports importing a local JSON manifest. Place the original `.wabbajack` archive beside it (or in a declared subfolder). Loadstone keeps manifest metadata in its local `live-catalog.json`; it does not redistribute the archive or its mods. Imports remain separate from demo installations.

Schema 1 requires these fields, with unknown fields rejected:

- `schemaVersion`: `1`; `id`: a stable lowercase slug (3–64 characters).
- `name`, `version`, `description`, `author`, `website` (HTTPS).
- `game`: `id` (`fnv`, `skyrimse`, or `fallout4`), `versions` (human-readable labels), `executableHashes` (supported lowercase SHA-256 values), `requiredFiles` (relative file paths and their `sha256`, including required DLC masters).
- `storage`: positive integer `downloadBytes` and `installBytes`, including temporary space needed by the list. These are author declarations; preflight checks available space against their combined total.
- `archive`: relative `file` ending in `.wabbajack`, `sha256`, and original HTTPS `source`.
- `launch`: `manager: "mo2"`, `profile` (a single directory name), `executable` (MO2 executable title). No shell commands or installation recipes are accepted.
- `credits`: entries with `name`, `author`, HTTPS `source`, and a `license` or distribution-permission statement. Declared permissions require human review before public distribution.

Preflight streams file hashes, checks required game files and archive integrity, rejects game/system/Loadstone folder overlap and nonempty destinations, and checks writability and free disk space. It does not create an install or modify the game. Steam discovery reads local library and app metadata and confirms the executable exists; it does not assert ownership from an install directory. GOG and other installations can be selected manually.

The installer connection deliberately fails preflight until the Wabbajack adapter and authentication are implemented and tested. A valid manifest alone does not make a setup installable. No real curated list is bundled yet.

Current upstream [Wabbajack install command](https://github.com/wabbajack-tools/wabbajack/blob/main/Wabbajack.CLI/Verbs/Install.cs) accepts `-w/--wabbajack`, `-o/--output`, and `-d/--downloads`. Runtime availability, authentication and progress reporting still need verification against a pinned released build before this interface is used.

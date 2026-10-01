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

Installation requires the verified engine, successful live preflight and source access. A valid manifest alone does not make a setup installable. No real curated list is bundled yet.

Preflight also reads the archive's actual `modlist` metadata. It checks game identity, required engine version, MO2/profile output files, bounded sizes, safe and unique Windows output paths, and declared storage against the archive's totals. Unknown download providers and lists requiring additional games are identified as unsupported. A verified engine is asked which game folder it would use; a different selection blocks installation rather than silently using another copy of the game.

The parser was checked against the locally cached Viva New Vegas 11.8.26 archive: 153 source archives and 17,630 output files. The pinned 4.2.3.0 CLI was also run to confirm its actual Fallout 4 and New Vegas selections. These are read-only compatibility checks, not evidence of a successful installation or permission to redistribute the list.

The pinned [Wabbajack install command](https://github.com/wabbajack-tools/wabbajack/blob/4.2.3.0/Wabbajack.CLI/Verbs/Install.cs) accepts `-w/--wabbajack`, `-o/--output`, and `-d/--downloads`. The runtime and command interface are verified; protected authentication and durable job recovery are implemented; full real-list installation acceptance remains outstanding.

## Updating an imported setup

Keep the same stable ID and use a different version label. Add optional schema-1 metadata (required when replacing an imported version):

```json
"update": {
  "fromVersions": ["1.0"],
  "saveCompatibility": "new-game-required",
  "notes": "Start a new game. Keep version 1.0 for existing saves."
}
```

Allowed compatibility values are `compatible`, `new-game-required`, and `unknown`. These are creator declarations, not Loadstone guarantees. Notes must explain the migration requirements. Version labels are opaque: Loadstone does not infer ordering from dates or semantic versions. Reimporting the same version is rejected, including altered archives; publish a new version instead. A game change under the same ID is rejected.

Import presents the old/new versions, creator/source and save guidance for confirmation, then checks the manifest has not changed before saving. Existing jobs retain their own manifest snapshots. Install a replacement in a separate empty folder; Loadstone keeps the prior profile, settings, saves and custom mods available for rollback. It does not migrate saves or customizations automatically. Installed versions appear in Library. Older failed jobs retry their owned archive using their original manifest, even after the catalog changes. If that archive is missing and the original manifest is no longer imported, restore the exact owned archive before retrying.

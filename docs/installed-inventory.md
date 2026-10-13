# Installed-setup inventory and native format direction

This work uses the selected profiles of the user's installed setups as the source of truth. Original modlist archives are source hints, not authoritative descriptions of the current installation. No live profile, mod, game, save or shortcut is modified by inventory.

## Read-only inventory

```powershell
node scripts/inspect-mo2.mjs <portable-instance> <new-local-report.json>
node scripts/inspect-mo2.mjs <portable-instance> <new-local-report.json> --hash-files
```

Keep reports under ignored `test-results/` or another private local directory. They contain personal paths and local filenames and must not be committed or published. The CLI refuses to replace a report. It reads the selected MO2 profile, resolves configured mod/profile locations, preserves the profile's recorded priority, inventories enabled mod directories and overwrite, and hashes profile files plus the installed loose plugin winning each conflict. Known source fields from `meta.ini` are hints only; other fields are excluded.

Default file inventories record size and modification time. `--hash-files` additionally hashes every enabled-mod and overwrite file. Neither mode is an atomic filesystem snapshot. File hashing rejects a file that changes while being read, and profile/configuration hashes are rechecked at the end. Stop active modding or gameplay before producing release evidence. Symlinks/junctions, ambiguous INI fields, duplicate mod entries and traversal names are rejected. Missing enabled mods/plugins are reported explicitly, not called a successful installation.

The report is **not installable and not publication-approved**. It does not establish archive contents/conflict resolution, full game-directory equivalence, runtime compatibility, source-download reproducibility or redistribution rights. Saves are not read from the profile. No network request or program launch is required to inspect an instance.

## Private source ledger

```powershell
node scripts/source-ledger.mjs hashed-inventory.json new-private-ledger.json downloads-folder [another-downloads-folder]
```

This command preserves the hashed installed-file records and finds candidate ZIP/7z/RAR archives using the recorded installation filename or a matching game/mod ID. It fingerprints candidate archives and reads only `gameName`, `modID` and `fileID` from their adjacent `[General]` metadata. It does not read credential header files, copy arbitrary metadata fields, extract archives or contact Nexus. Conflicting metadata and multiple versions remain explicit candidates; none is selected automatically.

The resulting ledger references the input inventory's SHA-256 and records unresolved reconstruction and unreviewed permissions. Matching a filename or Nexus mod ID does not prove an archive member equals an installed file. Exact member comparison, local edits, root/profile reconstruction and generated output remain separate work. Keep these ledgers private alongside inventories; the CLI refuses to replace them or write inside source/download directories.

```powershell
node scripts/map-zip-sources.mjs private-ledger.json new-private-mapping.json
```

The first member mapper verifies each candidate ZIP against its locked archive hash, then streams member hashes and compares them with installed size/SHA-256 pairs. It records exact member paths, retains all matching candidates and leaves locally changed files unresolved. It does not extract files or execute content. MO2 `meta.ini` is excluded because it needs privacy-aware regeneration. Each ZIP is accepted as a whole: unsafe paths, duplicate/colliding names, links, changed input or limit violations discard its potential matches. A cancellation aborts the pass.

Limits per archive: 50 GB compressed input, 500,000 entries, 100 GB declared uncompressed content, 1 GB per hashed member and 20 GB of hashed member data. Equivalent member candidates are limited to 128 per size/hash pair; the report accepts at most 500,000 match references. Exact byte matches still require source/rights review, profile and root reconstruction, and actual installation acceptance.

For optional 7z/RAR comparison, pass an absolute path to a trusted local x64 `7z.exe` (26.04 or newer, with its matching `7z.dll`):

```powershell
node scripts/map-zip-sources.mjs private-ledger.json new-private-mapping.json C:\Tools\7-Zip\7z.exe
```

The command retains its original name for existing workflows; this optional argument enables the additional formats. Archive signatures select the parser, so a ZIP cached under a `.7z` filename can be inspected without renaming or altering it. A signature only selects the parser; full archive hashes and structural validation still apply. Embedded/self-extracting formats remain unsupported. The tool path comes from the operator, never from a recipe. It runs without a shell or visible window, inventories the archive, rejects encrypted/linked/multipart/embedded or ambiguous entries, and reads each selected member into a bounded hashing stream. Nothing is extracted to disk. Literal selectors disable wildcards and list-file expansion. Archive and executable/library identities are checked between reads. Tool diagnostics stay out of reports.

For 7-Zip 26.04 and a Node runtime with `zlib.crc32`, bounded 7z archives with member CRCs use one streamed pass. The reader checks every file boundary against its listed CRC, computes SHA-256 for wanted sizes and accepts matches only after the complete stream, exit status and source identity pass. It handles up to 100,000 selected members and 20 GB of total streamed content without writing extracted files. The implementation was checked against upstream [listing order](https://github.com/ip7z/7zip/blob/26.04/CPP/7zip/UI/Console/List.cpp), [extraction indices](https://github.com/ip7z/7zip/blob/26.04/CPP/7zip/UI/Common/Extract.cpp) and [7z solid-block extraction](https://github.com/ip7z/7zip/blob/26.04/CPP/7zip/Archive/7z/7zExtract.cpp); a boundary mismatch discards all matches.

Other tool versions, RAR and archives without suitable checksums use one process per selected member, which can be slow for solid archives and is limited to 10,000 selected members. Each archive has a five-minute budget; a timeout or limit records an unresolved issue. The single-pass reader accepts members over 1 GB within its unchanged 20 GB total stream bound; individual-member and ZIP comparison retain a 1 GB member bound. Hashing a BSA as one archive member does not map files inside that BSA. The adapter is source comparison only; native reconstruction still accepts ZIP archives. No 7-Zip binary is bundled with Loadstone.

For tests, `scripts/prepare-sevenzip.ps1 -Destination <new-private-directory>` downloads the fixed official 26.04 x64 release, checks its published SHA-256, and unpacks only the command-line tool and notices with an existing 7-Zip. It does not install globally. Set `LOADSTONE_TEST_7ZIP` to the returned executable when running tests. Windows CI performs this setup and runs the real tool fixture; without the variable that optional integration test is skipped.

7-Zip is a separate upstream tool with LGPL, BSD and unRAR terms; a future bundled distribution needs its own notices/source compliance review. See the [official release](https://github.com/ip7z/7zip/releases/tag/26.04) and [license](https://www.7-zip.org/license.txt).

## Native `.loadstone` format

The user chose a documented format and open implementation on 2026-10-13. This is Loadstone's native format, not an opaque replacement for upstream archives. The implementation and specification will be developed together from the real inventories. The project license remains a separate maintainer decision.

The first [native format specification and package compiler](loadstone-format.md) are now available as experimental creator tooling. Inventory reports remain private evidence; they cannot bypass the source and rights work required for a valid recipe.

The target is a versioned, bounded container with a canonical recipe, source lock and content hashes. It must describe:

- Game/storefront/DLC requirements and exact accepted source hashes; TTW requires both owned games while running through the New Vegas engine.
- Mod priority, enabled and disabled state, plugin order, archive behavior, loose-file overrides, root files and generated output.
- Source URLs/provider file IDs and original archive hashes; an installed version string alone cannot identify a reproducible download.
- Differences between original archives and installed files, including locally edited INIs, generated LOD, compatibility patches, custom assets and menu-music transformations.
- Typed, bounded local reconstruction operations. No arbitrary shell recipes or remote scripts.
- A rights record for each payload: original source download, local owned-game input, redistributable content with evidence, or unresolved. Unresolved records block publication of the affected payload.
- Save compatibility, provenance, attribution and exact tested application/list/game versions.

A public list recipe must exclude personal machine paths, accounts, saves and raw logs. Source hashes and dependency references can describe a setup without uploading its game/mod payload. Any bundled files need separately established distribution rights. Local custom menu music built from owned game themes must be reconstructed locally or replaced with permitted material, not assumed redistributable.

## Compatibility and hosting boundaries

Wabbajack remains an external installation adapter. Native MO2 inspection is implemented here; import/compile/reconstruction are separate steps. Nexus collection compatibility requires study of the actual supported export/API format and applicable permissions before claiming support. Do not call every Nexus mod or arbitrary MO2 directory a directly installable Loadstone list.

GOG states that games are for personal use; DRM-free does not grant distribution rights. A paid storage service is therefore an architecture candidate for authorized assets and permitted backup scenarios, not an entitlement to serve common game mirrors. Evaluate Backblaze B2/AWS or alternatives after defining the rights, retention, encryption and cost model. No hosting subscription or paid infrastructure has been created. Sources: [GOG sharing guidance](https://support.gog.com/hc/en-us/articles/212184489-Can-I-share-games-with-others?product=gog), [Nexus API policy](https://help.nexusmods.com/article/114-api-acceptable-use-policy), [Wabbajack compilation guidance](https://wiki.wabbajack.org/modlist_author_documentation/Pre-Compilation.html).

## First live inventory findings (2026-10-13)

| Candidate | Selected installed profile | Enabled mods | Plugin entries | Enabled-mod files | Overwrite files |
| --- | --- | ---: | ---: | ---: | ---: |
| Combined TTW | Tale of Two Wastelands | 95 | 35 | 12,314 | 0 |
| FO3 Remastered | Fallout 3 Remastered | 88 | 30 | 8,982 | 0 |
| FNV Revamped | Viva New Vegas Extended | 196 | 82 | 93,106 | 207 |

These are inventory observations, not release or gameplay certification. All three had their enabled mod directories and listed loose plugins present. The two TTW instances point at their own isolated game folders; the customized New Vegas profile points at the installed Steam game. New Vegas retains enabled local prototypes and generated output, so publishing it faithfully requires reviewing those actual files rather than substituting the upstream VNV recipe.

Source-ID coverage is incomplete: 82/95 combined TTW mods, 78/88 FO3 Remastered mods and 144/196 New Vegas mods carry a nonzero Nexus mod ID in their local metadata. Even those IDs do not establish exact download file IDs, original archive hashes, unchanged installed bytes, compatibility or redistribution rights. Establish an explicit source/transform/permission ledger before producing featured installable packs.

The first local archive-ledger pass found candidates for 77/95 combined TTW mods, 73/88 FO3 Remastered mods and 146/196 New Vegas mods. It fingerprinted 78, 74 and 146 distinct archive paths respectively. Multiple candidates remain for 17, 17 and 43 mods; none had a conflicting filename/mod-ID hint in that pass. These counts measure source leads, not verified member mappings or publication readiness. No game/mod payload was uploaded.

The ZIP-only comparison then inspected 30, 29 and 58 archives and matched 650, 903 and 4,346 installed mod files respectively. The remaining 11,664, 8,079 and 88,760 mod files are unresolved in this pass, including private MO2 metadata and content whose candidates are 7z/RAR. Overwrite, game-root and profile reconstruction remain separate. A missing match does not by itself prove that a file was edited.

The later ZIP/7z/RAR pass with the verified 26.04 stream reader inspected 78, 74 and 144 archive candidates and matched 4,585 combined TTW, 4,826 FO3 Remastered and 15,795 New Vegas installed mod files. It left 7,729, 4,156 and 77,311 mod files unmatched, plus the separately inventoried overwrite files. All TTW/FO3 archive candidates were safely inspected; two New Vegas candidates remained unresolved. Source-cache gaps and generated/local content still dominate the missing mappings. TTW's full pass took 10.48 seconds on this machine and the New Vegas pass 48.68 seconds; these are local observations, not general performance guarantees. No installation file was changed or uploaded.

The subsequent content-detection pass resolved both remaining New Vegas archive issues: a ZIP stored with a `.7z` filename and a 1,219,819,547-byte terrain BSA above the previous member cap. All 146 candidate archives were inspected with zero archive issues, matching 15,992 installed files and leaving 77,114 unresolved. The ZIP kept its original filename and bytes. The large BSA was hashed as a whole member through the bounded single-pass reader; its contents were not extracted or independently mapped. This improvement is source work after the recorded 0.3.0 portable build, and does not certify any featured pack.

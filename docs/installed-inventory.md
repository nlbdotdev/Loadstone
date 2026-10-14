# Installed-setup inventory and native format direction

This work uses the selected profiles of the user's installed setups as the source of truth. Original modlist archives are source hints, not authoritative descriptions of the current installation. No live profile, mod, game, save or shortcut is modified by inventory.

## Read-only inventory

```powershell
node scripts/inspect-mo2.mjs <portable-instance> <new-local-report.json>
node scripts/inspect-mo2.mjs <portable-instance> <new-local-report.json> --hash-files
node scripts/inspect-mo2.mjs <portable-instance> <new-local-report.json> --hash-files --installation-files
```

Keep reports under ignored `test-results/` or another private local directory. They contain personal paths and local filenames and must not be committed or published. The CLI refuses to replace a report. It reads the selected MO2 profile, resolves configured mod/profile locations, preserves the profile's recorded priority, inventories enabled mod directories and overwrite, and hashes profile files plus the installed loose plugin winning each conflict. Known source fields from `meta.ini` are hints only; other fields are excluded.

Default file inventories record size and modification time. `--hash-files` additionally hashes every included enabled-mod and overwrite file. Add `--installation-files` to include selected-profile disabled mods, instance files and tools, the configured game directory, and all files in the selected profile, including configuration outside the original six-file snapshot. The additive `installation` record carries `instanceFiles`, `gameFiles` and `profileFiles`; mod records keep their original enabled/disabled state and priority. Unlisted mod directories and other profiles are outside this selected-profile baseline.

Configured mod/profile/game/overwrite directories are captured separately without duplicating their contents under the instance tree. The configured download cache is excluded. All scans skip known save/cosave paths, credential/browser stores, logs, caches and backup directories by path, before opening them; each excluded file or subtree is recorded with its scope and reason in `exclusions`. This is an explicit inventory boundary, not a claim that excluded state is reproducible. General configuration can contain private fields: its content is hashed, while only the existing allowlisted source hints are exported. Reports remain private. No file is executed, edited or uploaded.

Neither mode is an atomic filesystem snapshot. File hashing rejects changes while reading. At the end, every scanned tree is enumerated again and checked for added/removed files, file identity/size/timestamp changes and replaced directories; selected profile/configuration hashes are also rechecked. Stop active modding or gameplay before producing release evidence. Symlinks/junctions outside excluded state, ambiguous INI fields, duplicate mod entries and traversal names are rejected. Missing enabled mods/plugins are reported explicitly, not called a successful installation. Ctrl+C cancels scanning; no final report is written. Across scanned trees, inventories are bounded to one million included files, 100,000 excluded paths and 100,000 directories per tree.

The report is **not installable and not publication-approved**. Even with complete hashes for the included files, it does not establish upstream game equivalence, archive contents/conflict resolution, runtime compatibility, source-download reproducibility or redistribution rights. Saves are not read from the profile. No network request or program launch is required to inspect an instance.

MO2 instance plugin inventories also exclude CPython `__pycache__` files when their adjacent ordinary `.py` source is present. Each receives the explicit `regenerable-python-bytecode` reason; the source remains inventoried. Standalone bytecode, caches without a source, unknown cache naming and mod/game content remain included. This avoids pinning machine-dependent cache bytes that MO2 regenerates after relocation. Existing inventories, recipes and verification fingerprints are unchanged; use a new reviewed recipe/version to apply this boundary.

Winning loose-plugin records also retain `mtimeMs` (UTC milliseconds, rounded to an integer) alongside their SHA-256, size and winning layer. This is collected from the same stable hash pass. It lets a creator explicitly preserve timestamp-based load order in a new recipe without assigning that metadata to every mod file or silently changing existing reports. Hash-mode file inventories otherwise retain their existing size/hash shape.

## Private source ledger

```powershell
node scripts/source-ledger.mjs hashed-inventory.json new-private-ledger.json downloads-folder [another-downloads-folder]
node scripts/source-ledger.mjs hashed-inventory.json new-private-ledger.json downloads-folder --hints private-hints.json
```

This command preserves the hashed installed-file records and finds candidate ZIP/7z/RAR archives using the recorded installation filename or a matching game/mod ID. It fingerprints candidate archives and reads only `gameName`, `modID` and `fileID` from their adjacent `[General]` metadata. It does not read credential header files, copy arbitrary metadata fields, extract archives or contact Nexus. Conflicting metadata and multiple versions remain explicit candidates; none is selected automatically.

Expanded inventories retain their instance/game/profile hashes and explicit exclusions in the private ledger, with an allowlist of record fields. Inventoried disabled mods can receive archive candidates and exact member matches without being enabled. These added root/profile records remain unresolved until separately mapped or transformed; retaining hashes does not infer their sources or permission to distribute them.

The resulting ledger references the input inventory's SHA-256 and records unresolved reconstruction and unreviewed permissions. Matching a filename or Nexus mod ID does not prove an archive member equals an installed file. Exact member comparison, local edits, root/profile reconstruction and generated output remain separate work. Keep these ledgers private alongside inventories; the CLI refuses to replace them or write inside source/download directories.

When installed metadata cannot identify an archive already in the selected download folders, a creator can nominate it with a private UTF-8 JSON hints file:

```json
{
  "schemaVersion": 1,
  "kind": "loadstone-source-hints",
  "mods": [
    {
      "name": "Example installed mod",
      "archives": ["C:/CreatorCache/original.zip"]
    }
  ]
}
```

Each name must exactly match one inventoried mod with files, including disabled mods. Archive paths must be absolute and identify top-level ZIP/7z/RAR files in a download folder explicitly selected on the command line. Unknown fields, duplicate mod names or per-mod archive paths, redirected files and paths outside those folders are rejected. Limits are 5 MB per hints file, 10,000 mods, 100 archives per mod and 100,000 total references. Hints cannot add remote URLs, credentials or claimed provider IDs.

Hinted archives are fingerprinted and marked `creatorHint: true`; existing automatic match evidence is retained without duplicating a candidate. Conflicting known game/mod metadata remains a conflict and is skipped during member mapping. A hint never proves installed bytes, rights or reconstruction. The ledger retains the hints file's path and exact SHA-256; ledger creation rejects a changed hints file, and mapping refuses a hints file that has changed since the ledger was written. Keep that file private and stable alongside the reports. Ctrl+C cancels ledger creation without writing a final report.

```powershell
node scripts/map-zip-sources.mjs private-ledger.json new-private-mapping.json
```

The member mapper verifies each candidate ZIP against its locked archive hash, then streams member hashes and compares them with installed size/SHA-256 pairs. It records exact member paths, retains matching archive candidates and leaves locally changed files unresolved. It does not extract files or execute content. MO2 `meta.ini` is excluded because it needs privacy-aware regeneration. Each ZIP is accepted as a whole: unsafe paths, duplicate/colliding names, links, changed input or limit violations discard its potential matches. A cancellation aborts the pass.

Upstream ZIPs may use Windows backslashes in their internal names. These separators are normalized to `/` before path validation, collision checks and member selection; the original archive is never rewritten. Slash/backslash aliases, case collisions, traversal, absolute paths and file/directory overlaps still reject the entire archive. Mapped member paths use canonical forward slashes and can be passed directly to native reconstruction. `.loadstone` package entries and recipe paths remain strict and do not accept backslashes.

Limits per archive: 50 GB compressed input, 500,000 entries, 100 GB declared uncompressed content, 1 GB per hashed member and 20 GB of hashed member data. The report accepts at most 500,000 match references. Exact byte matches still require source/rights review, profile and root reconstruction, and actual installation acceptance.

When multiple members of one archive have identical size and SHA-256, the mapper keeps the lexicographically first normalized member path as a deterministic representative and records `equivalentMembers`, the count of verified members with those exact bytes. The mapping declares `memberSelection: "lexicographic-representative-per-content"`. This compact representation replaces the earlier 128-equivalent-member rejection and prevents the installed-file count from multiplying by the number of identical copies. Every selected member is still hashed; complete archive validation and stream checks must succeed before any matches are accepted. Different archives remain distinct candidates. A representative proves a byte-equivalent source, not which archive member the original installation used. Recipes still require review of the source and exact selected member.

For optional 7z/RAR comparison, pass an absolute path to a trusted local x64 `7z.exe` (26.04 or newer, with its matching `7z.dll`):

```powershell
node scripts/map-zip-sources.mjs private-ledger.json new-private-mapping.json C:\Tools\7-Zip\7z.exe
```

The command retains its original name for existing workflows; this optional argument enables the additional formats. Archive signatures select the parser, so a ZIP cached under a `.7z` filename can be inspected without renaming or altering it. A signature only selects the parser; full archive hashes and structural validation still apply. Embedded/self-extracting formats remain unsupported. The tool path comes from the operator, never from a recipe. It runs without a shell or visible window, inventories the archive, rejects encrypted/linked/multipart/embedded or ambiguous entries, and reads each selected member into a bounded hashing stream. Nothing is extracted to disk. Literal selectors disable wildcards and list-file expansion. Archive and executable/library identities are checked between reads. Tool diagnostics stay out of reports.

For 7-Zip 26.04 and a Node runtime with `zlib.crc32`, bounded 7z archives with member CRCs use one streamed pass. The reader checks every file boundary against its listed CRC, computes SHA-256 for wanted sizes and accepts matches only after the complete stream, exit status and source identity pass. It handles up to 100,000 selected members and 20 GB of total streamed content without writing extracted files. The implementation was checked against upstream [listing order](https://github.com/ip7z/7zip/blob/26.04/CPP/7zip/UI/Console/List.cpp), [extraction indices](https://github.com/ip7z/7zip/blob/26.04/CPP/7zip/UI/Common/Extract.cpp) and [7z solid-block extraction](https://github.com/ip7z/7zip/blob/26.04/CPP/7zip/Archive/7z/7zExtract.cpp); a boundary mismatch discards all matches.

Other tool versions, RAR and archives without suitable checksums use one process per selected member, which can be slow for solid archives and is limited to 10,000 selected members. Each archive has a five-minute budget; a timeout or limit records an unresolved issue. The single-pass reader accepts members over 1 GB within its unchanged 20 GB total stream bound; individual-member and ZIP comparison retain a 1 GB member bound. Hashing a BSA as one archive member does not map files inside that BSA. The same adapter also supports [native reconstruction](native-reconstruction.md), with separate extraction limits and operator-selected tool review. No 7-Zip binary is bundled with Loadstone.

For tests, `scripts/prepare-sevenzip.ps1 -Destination <new-private-directory>` downloads the fixed official 26.04 x64 release, checks its published SHA-256, and unpacks only the command-line tool and notices with an existing 7-Zip. It does not install globally. Set `LOADSTONE_TEST_7ZIP` to the returned executable when running tests. Windows CI performs this setup and runs the real tool fixture; without the variable that optional integration test is skipped.

7-Zip is a separate upstream tool with LGPL, BSD and unRAR terms; a future bundled distribution needs its own notices/source compliance review. See the [official release](https://github.com/ip7z/7zip/releases/tag/26.04) and [license](https://www.7-zip.org/license.txt).

For a separate read-only inventory of files inside a local Fallout 3/New Vegas BSA, see [BSA 104 inspection](bsa-inspection.md). This hashes the internal members but does not yet add nested-container matches to the ledger or native reconstruction.

## Native `.loadstone` format

The user chose a documented format and open implementation on 2026-10-13. This is Loadstone's native format, not an opaque replacement for upstream archives. The implementation and specification will be developed together from the real inventories. The maintainer separately selected GPL-3.0-or-later for the original implementation on October 13, 2026; third-party content retains its own terms.

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

The later expanded inventories also include disabled mods and explicit state exclusions. Creator hints against those baselines linked cached archives without modifying installed metadata. Exact matches rose from 4,586 to **9,500** for TTW Complete, 4,827 to **6,855** for FO3 Remastered and 16,706 to **30,060** for FNV Revamped. This leaves 2,864, 2,130 and 81,300 mod files unresolved respectively; game, instance, profile and overwrite records remain separate. The passes safely inspected 83, 82 and 156 archives. Three additional FNV quest archives exceeded the existing 128-equivalent-member limit, so none of their matches were accepted. These are comparison-limit failures, not evidence that the archives are corrupt. Further duplicate-content handling, source/transform work and rights review remain necessary. Hints and reports remain private; all installed sources are unchanged.

Compact equivalent-content matching subsequently verified all three previously rejected FNV archives. The Better Angels, Bounties III and Bounties II added **28,935** exact file matches, bringing FNV to **58,995 matched / 52,365 unmatched**, with all 159 candidates inspected and zero archive issues. TTW remains at 9,500 / 2,864 (83 archives), and FO3 Remastered at 6,855 / 2,130 (82 archives), both with zero issues. Every previously matched installed file retained a source match. These results use one verified representative per archive/content identity and do not establish which identical member the original install used, redistribution rights or playable acceptance.

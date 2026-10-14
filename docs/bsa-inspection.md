# BSA content inspection

The experimental creator command reads a local **BSA version 104** container and produces a private inventory of its normalized member names, exact uncompressed sizes and SHA-256 hashes:

```powershell
node scripts/inspect-bsa.mjs C:\CreatorCache\original.bsa C:\CreatorReports\bsa-inventory.json
```

Choose a new report outside the archive's directory. The command never extracts payload files, executes content or modifies the archive. Ctrl+C cancels without a final report. Keep reports private: member names can disclose installed content even though the report omits the local archive path.

The archive itself is hashed before inspection. All index, member, decompression and input-stability checks must pass before a report is returned. Exact shared data extents are supported; partially overlapping extents and conflicting compression declarations are rejected. Embedded filename blobs are validated but are not used as member paths: optimized archives may share one blob across several indexed names. Names use canonical forward slashes; duplicate/case-colliding paths, traversal, Windows special names and file/directory overlap are rejected.

This initial reader accepts the version-104 layout used by Fallout 3/New Vegas: a 36-byte header, folder/file name tables, printable ASCII names, optional zlib compression, per-file compression toggles and optional embedded names. It accepts archive flag bits `0x01`, `0x02`, `0x04`, `0x80` and `0x100`, with both name tables required. Other layouts/flags, non-ASCII names, BSA 103/105, BA2 and archive writing are unsupported. Rejection means the reader cannot safely inspect that variant, not that the game archive is necessarily corrupt.

Limits: 4,294,967,295 input bytes, 64 MiB metadata, 100,000 folders, 500,000 files, 1 GB per uncompressed member, 20 GB total logical member content (including shared copies) and five minutes per inspection. Hashing streams have bounded buffers; declared sizes, zlib input consumption and output counts are verified. The reader uses the same open file handle throughout and checks file identity afterward.

This report is **source evidence only**. It does not change the ZIP/7z/RAR ledger or automatically produce a recipe. To establish an upstream source chain, separately verify the outer download archive, its exact BSA member hash and the desired internal member hash. Compare the installed file's complete size/SHA-256; a similar name or image is insufficient. A reviewed recipe can use the explicit [`extract-bsa104` action](loadstone-format.md#outputs-and-actions) for [bounded nested-BSA reconstruction](native-reconstruction.md#nested-bsa-104-files). Transformed-file reproduction, rights review and real installation acceptance remain separate work. No game or mod data is bundled by this command.

The JavaScript implementation and synthetic fixtures are original. Format semantics were checked against Wabbajack's pinned [104/105 reader](https://github.com/wabbajack-tools/wabbajack/blob/4.2.3.0/Wabbajack.Compression.BSA/TES5Archive/Reader.cs), [folder records](https://github.com/wabbajack-tools/wabbajack/blob/4.2.3.0/Wabbajack.Compression.BSA/TES5Archive/FolderRecord.cs) and [file records](https://github.com/wabbajack-tools/wabbajack/blob/4.2.3.0/Wabbajack.Compression.BSA/TES5Archive/FileRecord.cs). Loadstone deliberately supports a narrower format subset.

## Nested source mapping

The separate creator command extends a private [source ledger](installed-inventory.md) with exact nested matches:

```powershell
node scripts/map-bsa-sources.mjs private-mapping.json new-private-bsa-mapping.json --mod "Example container mod" --7zip C:\Tools\7-Zip\7z.exe
```

Repeat `--mod` for other exact inventoried mod names. The selected mods must contain inventoried `.bsa` files and have original archive candidates in the ledger. Disabled mods can supply containers without being enabled. The optional `--7zip` is required for 7z/RAR candidates; ZIP comparison uses the built-in reader. No tool or original archive is downloaded by this command.

The mapper independently rehashes each selected original archive and validates its complete structure. It hashes candidate BSA members and compares their full size/SHA-256 with the installed BSA inventory. Only then does it inspect the matching local BSA, rechecking the complete container fingerprint and hashing its internal contents. The local file is a read-only witness of the verified original member; nothing is staged or extracted. It compares inner content with all managed mod-file fingerprints in the accepted ledger, including disabled mods, and excludes local `meta.ini`. It does not rehash every loose installed target during this pass, nor map game/root/profile/overwrite records.

Each matched file receives a separate `bsaSourceMatches` array. A reference records `archiveSha256`, `container: { member, bytes, sha256 }`, the inner `member` and the number of byte-equivalent inner members (`equivalentMembers`). The representative is the lexicographically first normalized inner path per container and content fingerprint. The original archive's fingerprint and available provider hints appear in `bsaMapping.sources`; provider hints still require review. These references supply the fields for a reviewed `extract-bsa104` action once a recipe source ID is assigned. They do not generate or approve a recipe.

Existing `sourceMatches`, the direct `mapping` report, mod states and other inventory records remain intact. `bsaMapping` separately reports nested matches, newly matched files and the combined unique file totals. Re-running the command replaces the nested extension from fresh checks without multiplying old references. A fresh direct archive-mapping pass clears the old nested extension, which must then be recomputed. Failed archives or containers produce unresolved issues; no partial matches from a failed inspection are accepted.

Limits: 64 selected containers, 20 GB total container bytes, 20 GB combined successfully inspected logical content, 1,000 candidate archive paths and 500,000 nested match references, in addition to the existing archive/BSA reader limits. ZIP and per-member 7z/RAR comparison retain their 1 GB member limit; eligible 7z archives can use the existing bounded single-pass reader for larger members. Other BSA versions and arbitrary nesting remain unsupported.

The command locks the input ledger, referenced inventory and optional source hints, checks them again before writing, refuses existing report paths and keeps reports outside installation/download roots. Ctrl+C cancels without a final report. Reports contain private paths and installed-content names: keep them outside public source. Matching bytes establish source evidence only; source rights, typed transformations, recipe validation and actual reconstruction/gameplay acceptance remain required.

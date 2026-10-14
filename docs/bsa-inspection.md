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

# Native .loadstone format, version 1

Status: experimental creator tooling. This is a documented format with an original implementation licensed under GPL-3.0-or-later. The repository remains private pending publication review. **Settings → Native package preview** inspects a user-selected package through the Electron bridge and shows a bounded summary. **Reconstruct a local candidate** can build local copy and ZIP/7z/RAR-extract recipes with durable history. The playable desktop catalog still uses Wabbajack; a native candidate needs configuration and launch acceptance before playable-library integration.

## Purpose and trust boundary

A package describes exact inputs and expected outputs for a portable, isolated MO2 setup. It references original downloads and locally owned game files. It can carry small payloads with declared distribution permissions. It has no shell actions, scripts, hooks, remote executable recipes or implicit path discovery. An archive source names a specific archive; an extract action names a specific member, without interpreting that member's extension as an instruction.

The installed inventory is separate private evidence. It is not a recipe: missing archive provenance, local changes, generated content and permissions must be resolved before compilation. A Nexus mod ID alone is insufficient. Do not replace a current custom installation with its upstream list while calling it equivalent.

SHA-256 verifies byte identity, not safety, authorship or rights. Version 1 packages are unsigned. Permission fields are creator declarations with review references; the validator cannot establish legal permission or approve publication. Gameplay, save compatibility and publisher trust require separate acceptance. Inspection always returns `publicationApproved: false`.

## Container

Use the `.loadstone` extension for a ZIP with these entries:

1. `recipe.json`, first in central-directory order, containing canonical UTF-8 JSON.
2. `payload/<sha256>` for each declared payload source, exactly once. No other entries, directory records, symlinks, devices, encrypted files or file comments are allowed. ZIP methods 0 (stored) and 8 (deflate) are accepted.

Canonical JSON recursively sorts object keys using JavaScript's default string ordering, preserves array order, uses `JSON.stringify` compact serialization and appends exactly one LF. No BOM. The parser validates the object and requires byte equality with that representation, rejecting duplicate keys and ambiguous alternate representations. Numbers are bounded safe integers wherever used. Recipe identity is SHA-256 of these canonical bytes; ZIP compression and timestamps do not define recipe identity.

The reference compiler orders payloads by their lowercase hex hashes, uses fixed timestamps/modes and stored entries. Given identical inputs on the same toolchain it creates identical package bytes. Inspection streams payload hashing and never extracts or launches content.

Limits: 64,000,000 recipe bytes; 100,000 sources; 500,000 outputs; 256,000,000 total uncompressed bundled payload bytes; 512,000,000 package bytes; at most source-count-limit plus one entries. Byte sizes are nonnegative safe integers; download/output totals are capped at 10 TB. These are parser limits, not recommended list sizes or machine resource promises.

## Recipe fields

All objects reject unknown fields. All listed fields are required unless marked optional or a source/action variant omits them. `electron/native-format.cjs` is the executable validator; fixtures in `tests/native-package.test.mjs` show a complete synthetic example. This experimental version is not yet a stable interchange contract; older previews reject newer optional fields safely.

| Field | Meaning |
| --- | --- |
| `format`, `formatVersion` | Literal `loadstone` and integer `1`; unknown versions fail closed |
| `id` | Lowercase letters, digits and hyphens; 1–64 characters, starting with a letter or digit |
| `name`, `version`, `author`, `description` | Nonempty text up to 500 characters, without control characters |
| `website` | HTTPS reference without userinfo, query or fragment |
| `game` | `{id, variant}`; targets `fnv`, `skyrimse`, `fallout4`; variant `base`, or `ttw` for FNV |
| `requirements` | Exact owned-game inputs, below |
| `prerequisites` | Optional local material the user prepares separately, below; omitted when none |
| `launch` | `{profile, executable, gameRoot}`; MO2 profile directory name, MO2 executable title, isolated relative game directory |
| `sources` | Inputs keyed by unique `id`, below |
| `outputs` | Expected final files and typed reconstruction actions, below |
| `saveCompatibility` | `{status, notes}`; status `unknown`, `new-save-required` or `compatible`; guidance up to 2,000 characters |

FNV is the full support target. Skyrim SE/FO4 remain in development. Fallout 3 can appear only as an owned input to TTW; it cannot be the target. Starfield is not accepted. Schema acceptance does not certify a game or list.

### Owned games

Each requirement is `{id, store, files}`. `store` is `steam` or `gog`. `files` contains 1–10,000 `{path, bytes, sha256}` records and must include that game's executable. The requirement set is exactly the target game for a base recipe, or FNV plus Fallout 3 for TTW. A recipe represents one exact accepted storefront/file set; a different version requires a different recipe. The specification does not claim ownership can be established from a file hash alone.

These references instruct the materializer to read a user's local input. They grant no permission to bundle or mirror game content. TTW conversion, patching and version alternatives need additional typed operations and acceptance before native TTW installation can be claimed.

### Local prerequisites

An optional `prerequisites` array declares 1–20 `{id, name, version, instructions, credit, files}` records. IDs follow the source-ID syntax and are unique within the array. Names/versions are nonempty text up to 500 characters. `instructions` is a public HTTPS reference without credentials/query/fragment, never fetched or executed automatically. `credit` uses the source attribution shape. Each `files` array locks exact `{path, bytes, sha256}` records, with the same safe-path rules as owned inputs. Across prerequisites the limits are 100,000 files and 10 TB.

The user selects an existing folder for each prerequisite. Every locked file is checked before output creation, and source folders cannot overlap the destination. A `prerequisite-file` source copies a declared local file with an identical hash and byte length. Every prerequisite must supply at least one used source. This can represent a separately prepared dependency without bundling or mirroring its bytes. It is not proof of ownership, distribution permission or automated TTW conversion; the TTW variant still requires both owned games independently. Actual TTW integration remains unaccepted.

### Sources

Every source has `id`, `type`, `bytes` and lowercase 64-character `sha256`.

| Type | Additional fields |
| --- | --- |
| `game-file` | `game`, `path`; must match the path/hash/size of a locked requirement file |
| `prerequisite-file` | `prerequisite`, `path`; must match a file in that declared local prerequisite |
| `nexus-archive` | `game`, positive integer `modId`, positive integer `fileId`, `credit` |
| `https-archive` | `url`, `credit` |
| `payload` | `credit`, `permission`; exactly one corresponding container entry |

Nexus `game` is `falloutnv`, `fallout3`, `skyrimspecialedition` or `fallout4`. Credentials and download tokens are resolved at runtime, never stored in a recipe. A `credit` is `{name, url}`. A payload's `permission` is `{license, evidence}`, with a nonempty license description up to 200 characters and an HTTPS evidence reference. URL fields reject credentials, query parameters and fragments to exclude typical signed links and tokens; human privacy review remains necessary.

Every source must be used. Bundled hashes cannot be declared twice. Sources do not contain private local paths. The desktop's [archive acquisition layer](native-downloads.md) enforces network destination, redirect and account policy separately; accepting an HTTPS string is not permission to fetch arbitrary endpoints.

### Outputs and actions

Copy/extract outputs are `{path, bytes, sha256, action}`. A generated MO2 configuration instead uses `{path, action}` with destination-specific fingerprinting as described below. File paths use `/`, are relative NFC strings up to 240 characters, and reject Windows device names, drive/UNC paths, alternate data streams, traversal, empty segments, trailing dots/spaces and reserved characters. Windows case-insensitive duplicates and file/directory overlap are rejected. Paths containing a `saves` component or a component starting `.loadstone` are reserved.

- `{type: "copy", source: "source-id"}` copies a `game-file`, `prerequisite-file` or `payload`. Expected output bytes/hash must equal the input.
- `{type: "extract", source: "archive-id", member: "Data/Example.esp"}` selects one safe member of a locked Nexus/HTTPS archive. The output hash is the hash of the extracted member. Nested archives, FOMOD execution, binary patches and arbitrary text substitution are not implemented by this version.
- `{type: "mo2-config", gameEdition: "Steam", executables: [...]}` generates only `ModOrganizer.ini` from bounded, relative executable declarations and recipe game/launch fields. `gameEdition` accepts `Steam` or `GOG` matching the target game requirement; executable entries may declare `steamAppId` matching the supported target game and its Steam requirement. Both fields are optional for legacy recipes, whose exact generated bytes remain unchanged. It has no source or static output fingerprint. The materializer computes the exact destination-specific bytes/hash before writing and records them in the receipt after verification. An empty, fingerprinted `portable.txt` output is required. See the [complete generator contract](native-mo2-configuration.md), including serialization, size bounds and unsupported settings.

Outputs must include `ModOrganizer.exe`, `ModOrganizer.ini`, the declared profile's `modlist.txt` and `plugins.txt`, and the target game executable beneath `launch.gameRoot`. Mod priorities, disabled entries and plugin order are carried by the exact profile files. They are not inferred from source order. Final-file verification checks each static or derived output fingerprint after reconstruction. Save paths may never be claimed as owned recipe outputs.

## Creator commands

Place reviewed bundled files in a private directory, named by their SHA-256 hashes. A recipe with no payloads can use an empty directory. Commands never replace an existing package:

```powershell
node scripts/native-package.mjs pack recipe.json private-payloads example.loadstone
node scripts/native-package.mjs inspect example.loadstone
```

The compiler validates and hashes all bundled bytes, creates the output exclusively, and re-inspects the finished archive. Changed inputs or mismatched hashes fail. It refuses output paths inside the payload directory. Keep personal inventories, local manifests and unreviewed packages under ignored `test-results/`; do not commit them.

## Next implementation gates

An [experimental local materializer](native-reconstruction.md) reconstructs copy and ZIP/7z/RAR-extract recipes in a new isolated directory and verifies every output hash. It is separate from the desktop queue and does not establish playability.

Complete installed-file/source mapping; add bounded reconstruction for edited/generated files; verify real provider downloads and extend supported source flows; extend durable creator jobs with partial-build recovery and playable-library integration. Preserve the existing launch/shortcut/removal ownership checks. Prove actual clean installation and gameplay before publishing the three featured recipes or assigning 1.0.

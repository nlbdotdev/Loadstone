# Publication hygiene audit

Run `pnpm audit:publication` from a complete local checkout after fetching the refs intended for publication. The command reads unique file blobs from all commits reachable from local refs and writes `test-results/publication-audit.json`. It never changes Git history or repository visibility. Reports include rule, blob ID, file and line, not matched values or source excerpts. Keep reports local until reviewed.

The scanner checks recognizable private-key headers, selected provider-token formats, credential-bearing URLs, sensitive query parameters, personal home-directory paths and sensitive filenames. It inventories binary/non-UTF8/large blobs for manual review rather than silently treating them as clean. Exit status zero means the scan completed; it does **not** mean publication is cleared. There is no automatic allowlist for test directories.

## Initial review, 2026-10-01

Baseline source: `8245844d5fdbfe82d6f7ff7c351cbaa842462161`. Available local refs contained 46 commits and 241 unique blobs: 235 UTF-8 text blobs scanned and six binary assets inventoried.

The scan reported 17 text matches, including three in that HEAD:

- Fourteen revisions of `tests/live.test.mjs` contain the same deliberately invalid credential-bearing example URL used to test manifest rejection.
- `tests/fixtures/installer-child.cjs` contains a synthetic query-token value used to prove log redaction.
- `tests/diagnostics.test.mjs` contains a synthetic personal-path canary used to prove diagnostic privacy.
- Historical `docs/portable-verification.json`, blob `5218a659da29ef7314c1efed0e703e873f5c6de5`, contains a personal absolute executable path. The current file had already been changed to a basename, but the older blob remains reachable.

Visual review found a personal Windows path in the old `docs/screenshots/settings.png`, blob `854eacef22babdb4e9def4f0ca339e56e66f4a43`. This change replaces the current screenshot with a fresh capture of the actual UI from isolated app data, using a neutral demo install path and no connected account. The older screenshot remains in Git history. Discovery and Library screenshots were visually reviewed without finding personal paths or credentials in their displayed content.

The five current PNG assets were inspected for chunk types. Discovery, Library, Settings and the icon contain image chunks only. `public/worlds.png` also contains a `caBX` provenance container; it is retained and still needs provenance-metadata review. The icon ICO container, release assets, commit messages and author identities need separate review. Visual inspection and a small rule set cannot prove absence of sensitive material.

## Public-source review, 2026-10-13

The maintainer confirmed that this source repository should remain public. The review at `f6e399cc0523c988375fd4996cde8af9a7197be7` fetched remote branches, tags and all 60 pull-request heads. The available refs contained 147 commits and 744 unique file blobs: 737 UTF-8 text blobs and seven binary assets.

The scanner reported 27 matches, seven in the current tree. Twenty-six are synthetic test inputs across revisions of the live-manifest, installer, download, source-ledger and diagnostic tests. The remaining text match is the historical executable path described above. No actual credential was identified by this review.

An additional review covered tracked path inventories, internal-workspace identifiers, commit messages and identities, the 60 public pull-request titles/descriptions, and the available issue/review comments. No unrelated project implementation was identified. The current acceptance-plan document contained internal workflow references; these are removed from the current tree. Their historical versions remain reachable. Commit identities contain the maintainer's existing name/email; this change does not rewrite them.

The three current screenshots and both standalone PNG artwork files were visually inspected. The historical Settings screenshot still displays a personal Windows path. The current screenshot and other displayed artwork showed no private workspace content. PNG chunk inspection found only image chunks except for the existing `worlds.png` C2PA provenance container. Its readable metadata describes the image-generation service, timestamps, content hashes and signing certificates; no personal installation path or unrelated project content was identified. The ICO contains seven PNG images with image chunks only and no trailing bytes. This inspection does not validate the provenance signature or rule out every possible binary encoding.

GitHub lists one public release, `v0.1.0`, with an executable and checksum. The downloaded executable matched the published checksum and was inspected as an archive without running it. Its application archive contained 4,891 files; 4,889 UTF-8 files were scanned without credential-pattern or internal-workspace matches. All three packaged main-process source files matched the release tag byte for byte. This is a bounded content review, not a security certification of the executable or its dependencies. Newer private candidate packages remain outside Git and were not uploaded.

## Ongoing publication hygiene

The historical report, screenshot and internal workflow references are already in public history. Removing their current versions does not remove that disclosure. A history rewrite would need a separate reviewed plan covering branches, tags, pull-request refs, release source snapshots and downstream clones; no rewrite or force push was performed. The maintainer's decision to keep the repository public is not evidence that these older disclosures have disappeared.

Review commit identities/messages, generated provenance metadata, release packages, untracked material proposed for publication, and any refs not present locally. Re-run the audit after changes and investigate new findings individually. If an actual credential is found, revoke it at its provider before considering history cleanup. The current matches were classified as fixtures or personal-path material; this is not a general credential-free certification.

The source-code license is GPL-3.0-or-later and public source availability is authorized. This audit does not settle distribution compliance, attribution gaps, security-reporting contacts, Nexus registration, real installation acceptance, or approval to upload a binary release. See [open-source preparation](open-source.md).

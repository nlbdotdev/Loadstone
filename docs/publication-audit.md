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

## Before publishing

Resolve how to handle the historical report and screenshot before making existing history public: retain them with explicit acceptance of the personal-path disclosure, or prepare a separately reviewed sanitized publication history. No history rewrite or force push has been performed by this audit. Do not assume deleting a file in a new commit removes the older contents.

Review commit identities/messages, generated provenance metadata, release packages, untracked material proposed for publication, and any refs not present locally. Re-run the audit after changes and investigate new findings individually. If an actual credential is found, revoke it at its provider before considering history cleanup. The current matches were classified as fixtures or personal-path material; this is not a general credential-free certification.

The source-code license has since been selected as GPL-3.0-or-later. This audit does not settle distribution compliance, attribution gaps, security-reporting contacts, Nexus registration, real installation acceptance, or approval to change repository visibility. See [open-source preparation](open-source.md).

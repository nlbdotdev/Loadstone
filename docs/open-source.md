# Open-source release preparation

The repository remains private and `package.json` remains `UNLICENSED`. GPL-3.0-or-later is a candidate, not an adopted license. Documentation and third-party notices do not grant a license to Loadstone code or branding.

## Provenance inventory

| Component                            | Current treatment                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loadstone app, adapter and tests     | Project-authored source; project license decision pending.                                                                                                                                                                                                                                                                                  |
| Production JavaScript dependencies   | Versioned inventory and original license texts in `notices/`; regenerate with `pnpm notices`.                                                                                                                                                                                                                                               |
| Electron runtime                     | MIT license included in generated notices; packaged Electron and Chromium license files must remain with distribution.                                                                                                                                                                                                                      |
| Wabbajack 4.2.3.0                    | Downloaded unmodified from upstream at user request, separate process; not committed or bundled in Loadstone's portable package. Upstream [GPL license](https://github.com/wabbajack-tools/wabbajack/blob/4.2.3.0/LICENSE.txt) and its included component notices apply. Review distribution/source obligations before changing this model. |
| MO2 and mods                         | Supplied by creator lists and original sources, not bundled by Loadstone. Review each list's distribution rights separately.                                                                                                                                                                                                                |
| Lucide icons                         | Original package license copied into generated notices.                                                                                                                                                                                                                                                                                     |
| Fonts                                | `src/fonts.css` uses locally installed Segoe UI. No font binaries are shipped.                                                                                                                                                                                                                                                              |
| Compass logo and desktop icon        | Project-created geometry; recorded in [artwork provenance](artwork.md). Branding use policy remains to be decided.                                                                                                                                                                                                                          |
| Discovery backgrounds                | AI-generated illustrative artwork with the prompt recorded in [artwork provenance](artwork.md). Review for release suitability and avoid claims of exclusive rights or captured gameplay.                                                                                                                                                   |
| Game names and fictional demo setups | Game trademarks identify compatibility; no endorsement is claimed. Demo setups are not available modlists. Review store and README wording before publication.                                                                                                                                                                              |

The dependency inventory is evidence for review, not a legal compatibility determination. No upstream Wabbajack/MO2 source is copied into the current app. Future linking, source reuse, bundling or modifications require another review. Build/test tooling is not fully covered by the production inventory; audit anything added to source archives or shipped build tools.

Current notice gaps: installed `is-reference@3.0.3` and `locate-character@3.0.0` declare MIT but include no standalone license text. The generator records these gaps rather than inventing upstream copyright notices. Resolve attribution or document their exclusion from shipped artifacts before public distribution. Generating the inventory does not clear this gate.

## Publication gates

- Choose the project license and version, add its full text, update package metadata and contribution terms, and decide how artwork and branding are covered.
- Review all dependency license texts and notices against the actual package, including Electron/Chromium and external-tool distribution behavior. Do not assume a package's SPDX label is its complete notice.
- Enable a monitored private security-reporting channel; finalize support and version-support policy.
- Review tracked files, screenshots, fixtures and the complete Git history for secrets, signed URLs, personal paths and private material. Rotate any exposed credentials before considering history cleanup.
- Verify the public README against the release artifact, link its exact source tag, and separate developer preview limitations from supported features.
- Complete Windows install-to-play, Steam shortcut, recovery, save-preservation and removal acceptance; prepare the distinct Steam depot and store materials.
- Obtain an explicit publication request before changing repository visibility or publishing a public release.

These gates remain open. This document records preparation, not approval to publish.

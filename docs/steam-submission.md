# Steam submission draft

Internal preparation for **0.2.0 developer preview**, reviewed against public Steamworks documentation on 2026-10-01. This packet has not been submitted. Store copy below remains gated on real acceptance and the decisions recorded here; do not paste it into a public page as a release announcement.

## Product setup

Propose application type **Software**, category **Player Tools**. Valve lists Player Tools among eligible non-game categories; this is a proposed fit, not a determination that Loadstone will be accepted. See [application types](https://partner.steamgames.com/doc/store/application) and [Steam Direct categories](https://partner.steamgames.com/steamdirect).

| Field | Proposed value / outstanding decision |
| --- | --- |
| Product name | Loadstone; complete name/branding review before submission |
| Platform | Windows x64; English interface, mouse and keyboard |
| Launch | `Loadstone.exe` in the directory depot; see [depot instructions](steam-release.md) |
| Developer / publisher | Maintainer must supply the actual legal/account identity |
| Price / release date | Undecided; do not infer either from open-source plans |
| Support / privacy | Publish reviewed support and privacy destinations; repository is currently private |
| Minimum requirements | Establish on clean Windows hardware; development-host success is not a certified minimum OS, RAM or GPU specification |
| Storage | Measure the final directory build and engine overhead separately; every list additionally needs its own downloads, installed files and recovery space |
| Steam feature claims | No Workshop, Cloud, achievements, controller, Deck or Linux claims. Local non-Steam shortcuts are a separate app feature |

## Store copy for review

### Short description

Loadstone brings compatible Bethesda modlists into one Windows library. Import a creator setup, check requirements, install through Wabbajack, and launch its Mod Organizer profile. Games, compatible lists and Nexus access are supplied separately.

### About this software

Give your modded worlds a home. Loadstone is a Windows desktop tool for installing and managing compatible Bethesda game setups from creator manifests and original Wabbajack archives.

Review a setup's game requirements, source archive and storage needs before installation. Follow installation progress, inspect failures, and keep installed profiles together in your library. Launch through the configured Mod Organizer profile and create desktop or local Steam shortcuts for your setup.

Maintenance controls include declared list updates, retry paths and removal that preserves supported save locations in a recovery folder. Keep your own backups: recovery is not a guarantee that every mod stores saves in a recognized location.

You must own and install the required game and DLC and obtain a compatible creator manifest and its original archive. Automated Nexus downloads require an eligible Nexus account with Premium access and a locally entered API key. The installation engine is downloaded separately. Availability depends on the list's original download sources.

Loadstone does not include Bethesda games or a playable mod collection. The bundled demonstration catalog is illustrative. Compatibility is specific to each creator setup; a Wabbajack archive alone is not a promise of complete game preparation. Some lists require additional steps documented by their authors.

## Evidence and claim gates

| Claim | Current evidence | Required before release copy is approved |
| --- | --- | --- |
| Import and preflight | Real VNV archive, installed game and pinned runtime checked; [acceptance record](vnv-acceptance.md) | Creator-approved supported manifest, clean original game and authenticated source access |
| Install and launch | Implemented adapter, output verification and fixture tests | Complete real download-to-play session on a clean machine; verify selected profile and game behavior |
| One-click setup | Optional isolated game-root validation implemented | A permitted list that actually produces a self-contained playable setup. Current cached VNV requires manual game preparation; do not advertise one-click VNV |
| Shortcuts and maintenance | Native desktop and Steam-file fixtures, recovery/update tests | Actual Steam-client launch/restart/update/uninstall and real save-preservation acceptance |
| Nexus access | Local protected credential storage and membership checks | Public application registration and real authorized authentication; never supply reviewer credentials in Git or public docs |
| Open source | Contributor/privacy/security docs, dependency notices and history audit prepared | Maintainer license choice, distribution review and publication audit decisions; currently private and UNLICENSED |

The current portable build is a local preview, not a Steam depot acceptance result. Record the exact candidate source commit, artifact hashes, depot build ID, test machine and outcomes in a release-specific acceptance report. Valve reviews the store presence and build; local tests do not replace that review. See [Valve review process](https://partner.steamgames.com/doc/store/review_process).

## Artwork and screenshot production

Use the existing charcoal, copper and ivory palette with the original compass-stone mark. Keep the title readable at small sizes. Capsule text should be limited to the product title; avoid feature promises, prices, third-party logos or approval badges. Export from purpose-made compositions, not stretched UI screenshots.

| Asset | Pixels | Status |
| --- | --- | --- |
| Store header | 920 x 430 | Pending |
| Store small capsule | 462 x 174 | Pending; inspect reduced-size legibility |
| Store main capsule | 1232 x 706 | Pending |
| Store vertical capsule | 748 x 896 | Pending |
| Library capsule | 600 x 900 | Pending |
| Library header | 920 x 430 | Pending |

Sizes and capsule guidance: [store assets](https://partner.steamgames.com/doc/store/assets/standard), [library assets](https://partner.steamgames.com/doc/store/assets/libraryassets). Also produce the library hero, transparent logo and client/community icons using Valve's current templates before upload; the app icon alone is not a complete asset kit.

Capture at least five real app screenshots at 1920 x 1080 or larger, 16:9, following [Valve's screenshot requirements](https://partner.steamgames.com/doc/store/assets/standard). Planned subjects:

1. A permitted real creator setup with accurate requirements and credits.
2. Actual preflight results for the supported game/list.
3. A real installation in progress.
4. The installed library entry and configured launch profile after successful play acceptance.
5. Real maintenance or shortcut controls for that same installation.

Use a clean capture workspace with non-personal folder names and no credentials, account identity or private paths visible. Keep source captures and their build identity. Existing design renders and test screenshots with simulated jobs/accounts are not evidence of these workflows and are not approved store screenshots. Do not substitute concept art for captured product behavior.

## Content survey draft

The app includes pre-generated AI landscape illustrations as discovery backgrounds. It does not generate images, text or other content with AI while running. Proposed disclosure: **AI tools were used to create the landscape illustrations used in the discovery interface. These are illustrative backgrounds, not screenshots of installed games.** Check the final shipping assets against [artwork provenance](artwork.md) when completing the survey.

Valve's current survey distinguishes shipped, player-consumed AI content from development productivity tools, and asks separately about live generation. Review all survey sections against the actual candidate, including any future curated content; do not infer content ratings from this draft. See [Content Survey](https://partner.steamgames.com/doc/gettingstarted/contentsurvey).

## Submission handoff

Before any upload, close the claim gates above, complete [open-source preparation](open-source.md) and [publication audit](publication-audit.md), finalize public support/privacy destinations, and produce the missing graphics and real captures. Prepare a reviewer walkthrough with the permitted list source, prerequisites, expected results and known limitations. Arrange authorized reviewer access separately without committing credentials.

Then generate and verify a clean directory depot using [the release procedure](steam-release.md), test it through the actual Steam client and record the assigned build ID. Complete the Steamworks checklists and survey against that exact build. This document does not authorize a purchase, account submission, upload, public repository change or release.

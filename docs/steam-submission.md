# Steam submission draft

Internal preparation for **0.4.0 native installation preview**. Product copy was updated October 13, 2026; linked Steamworks requirements were last reviewed October 1 and must be checked again before submission. This packet has not been submitted. Store copy below remains gated on real acceptance and the decisions recorded here; do not paste it into a public page as a release announcement.

## Product setup

Propose application type **Software**, category **Player Tools**. Valve lists Player Tools among eligible non-game categories; this is a proposed fit, not a determination that Loadstone will be accepted. See [application types](https://partner.steamgames.com/doc/store/application) and [Steam Direct categories](https://partner.steamgames.com/steamdirect).

| Field | Proposed value / outstanding decision |
| --- | --- |
| Product name | Loadstone; complete name/branding review before submission |
| Platform | Windows x64; English interface, mouse and keyboard |
| Launch | `Loadstone.exe` in the directory depot; see [depot instructions](steam-release.md) |
| Developer / publisher | Maintainer must supply the actual legal/account identity |
| Price / release date | Undecided; do not infer either from open-source plans |
| Support / privacy | Publish reviewed support and privacy destinations; source repository is public; confidential security reporting remains unfinished |
| Minimum requirements | Establish on clean Windows hardware; development-host success is not a certified minimum OS, RAM or GPU specification |
| Storage | Measure the final directory build and engine overhead separately; every list additionally needs its own downloads, installed files and recovery space |
| Steam feature claims | No Workshop, Cloud, achievements, controller, Deck or Linux claims. Local non-Steam shortcuts are a separate app feature |

## Store copy for review

### Short description

Loadstone brings compatible Bethesda setups into one Windows library. Open a .loadstone recipe, select your owned games and original files, then build and manage a separate Mod Organizer setup. Compatible Wabbajack lists use an optional engine.

### About this software

Give your modded worlds a home. Loadstone is a Windows desktop tool for installing and managing compatible Bethesda game setups. Its documented .loadstone format describes required games, original sources, verified output files and the intended Mod Organizer profile. Loadstone's original source is licensed under GPL-3.0-or-later.

Review a setup's game requirements, original archives and prepared prerequisites before installation. The native guide builds into a separate folder, shows measured progress and verifies the result before you explicitly add it to your library. Launch through the configured Mod Organizer profile and create desktop or local Steam shortcuts for your setup.

Resume interrupted native builds after a fresh review. Repair missing or damaged recipe files while retaining replaced originals, or install a different version in a separate folder while preserving the previous playthrough. Reviewed native removal retains profiles, saves, configuration, modified files and untracked content. Keep your own backups: new setup versions may require a new game, and unusual mod save locations require individual review.

You must own and install the required games and DLC and obtain a compatible recipe and its declared original files. TTW requires both Fallout: New Vegas and Fallout 3. Native local-only recipes need no Nexus connection or Wabbajack engine. For declared Nexus files, choose guided browser downloads with local hash verification or automatic downloads with eligible Premium access and a locally protected API key. Browser sign-in and downloading remain user actions. 7z/RAR extraction requires a separately supplied trusted tool; availability depends on the original download sources.

Compatible Wabbajack setups use a separate creator manifest and the original Wabbajack archive, with an optional upstream engine downloaded independently. Wabbajack files, MO2 installations and Nexus collections are not interchangeable .loadstone packages.

Loadstone does not include Bethesda games or a playable mod collection. The bundled demonstration catalog is illustrative. Compatibility is specific to each creator setup; a Wabbajack archive alone is not a promise of complete game preparation. Some lists require additional steps documented by their authors.

## Evidence and claim gates

| Claim | Current evidence | Required before release copy is approved |
| --- | --- | --- |
| Import and preflight | Real VNV archive, installed game and pinned runtime checked; [acceptance record](vnv-acceptance.md) | Creator-approved supported manifest, clean original game and authenticated source access |
| Native installation | Documented format, real Electron guided installation/resume/admission and full-size private TTW reconstruction of 13,952 outputs | Reproducible permitted original-source recipe; real account downloads and clean Windows install-to-play |
| Install and launch | Implemented native/engine launch paths; [partial TTW Steam-client evidence](native-steam-acceptance.md) | Resolve direct Steam startup failure; verify recording, disposable gameplay, isolated save/reload and selected-profile behavior |
| One-click setup | Optional isolated game-root validation implemented | A permitted list that actually produces a self-contained playable setup. Current cached VNV requires manual game preparation; do not advertise one-click VNV |
| Shortcuts and maintenance | Real Steam shortcut preservation/running-client safeguard; native repair, separate-version and retained-removal Electron fixtures | Complete uninterrupted Steam launch, actual depot update/uninstall and maintenance after real play with save-preservation evidence |
| Nexus access | Local protected credential storage, membership checks, native automatic acquisition and guided manual verification; browser handoff intercepted in fixtures | Public application registration and real authorized authentication/downloads; never supply reviewer credentials in Git or public docs |
| Open source | Contributor/privacy/security docs, dependency notices and history audit prepared | GPL-3.0-or-later selected for original source; corresponding-source delivery, distribution/asset review and publication audit decisions remain open; source repository is public; binary release acceptance remains open |

The current portable build is a local preview, not a Steam depot acceptance result. Record the exact candidate source commit, artifact hashes, depot build ID, test machine and outcomes in a release-specific acceptance report. Valve reviews the store presence and build; local tests do not replace that review. See [Valve review process](https://partner.steamgames.com/doc/store/review_process).

## Artwork and screenshot production

Use the existing charcoal, copper and ivory palette with the original compass-stone mark. Keep the title readable at small sizes. Capsule text should be limited to the product title; avoid feature promises, prices, third-party logos or approval badges. Export from purpose-made compositions, not stretched UI screenshots.

| Asset | Pixels | Status |
| --- | --- | --- |
| Store header | 920 x 430 | Generated draft; final review pending |
| Store small capsule | 462 x 174 | Generated draft; inspect reduced-size legibility |
| Store main capsule | 1232 x 706 | Generated draft; final review pending |
| Store vertical capsule | 748 x 896 | Generated draft; final review pending |
| Library capsule | 600 x 900 | Generated draft; final review pending |
| Library header | 920 x 430 | Generated draft; final review pending |

Sizes and capsule guidance: [store assets](https://partner.steamgames.com/doc/store/assets/standard), [library assets](https://partner.steamgames.com/doc/store/assets/libraryassets). Run `pnpm assets:steam` to generate these six assets plus a 3840 x 1240 library hero and a transparent 1280 x 280 library logo under `release/steam-artwork/`. See [artwork provenance](artwork.md). Client/community icon preparation and final Steamworks preview remain pending; this draft kit is not approval to upload.

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

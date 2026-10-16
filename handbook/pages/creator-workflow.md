# Creator workflow

Start with a specific installed version and its chosen profile. An upstream list is a useful lead, but it does not necessarily describe local changes, generated output, disabled mods or the files that are actually in use.

## 1. Capture installed truth

Use the [inventory tooling](../../docs/installed-inventory.md) to record hashes, mod ordering and enabled states, profile configuration, instance/game files and overwrite content. Preserve existing saves and live installations. Keep the inventory outside source control: it contains private paths and installed-content names.

## 2. Find and prove sources

Build a private source ledger from the accepted inventory and selected download folders. Add explicit creator hints when automatic archive leads are incomplete. Compare original ZIP/7z/RAR members by exact size and SHA-256. An adjacent metadata ID is a lead, not proof of the file's contents or its rights.

For installed BSA containers, use [nested BSA mapping](../../docs/bsa-inspection.md#nested-source-mapping) to verify the original member and its internal files. Keep unresolved generated/edited files visible. A similar filename or rendered image is not an exact replacement.

## 3. Review rights and required inputs

For every distributed source or asset, record authorship, attribution, permitted delivery and the required user-owned inputs. Original downloads, local owned-game reconstruction and hosted payloads are distinct cases. A local file that happens to install successfully is not automatically redistributable. Loadstone's GPL license does not grant rights to third-party mods or game files.

## 4. Write a typed recipe

Use the [format reference](../../docs/loadstone-format.md) for exact field names and limits. Declare outputs with hashes and required timestamps. Prefer original archive sources when supported; declare prepared prerequisites honestly where automatic conversion is not implemented. Configure portable MO2 with the [destination-bound configuration action](../../docs/native-mo2-configuration.md). Do not import account/browser state or arbitrary shell scripts.

## 5. Compile and inspect

Compile the recipe into a package and inspect it before reconstruction. Review source hosts, requirements, output paths, storage, profile and save guidance. Package validation must succeed independently of any installed baseline used to create it. The native [reconstruction guide](../../docs/native-reconstruction.md) documents CLI and desktop entry points.

## 6. Reconstruct and compare

Build into a new isolated candidate. Verify every required output and declared timestamp, then compare against the intended baseline. Exercise cancellation, reviewed resume and relevant maintenance behavior with disposable candidates. Do not substitute a successful inventory scan for actual reconstruction.

## 7. Accept the playable setup

Review library admission, launch, shortcuts, a disposable new game, save/reload and the intended input devices. Repeat on a clean Windows environment with the required owned games and sources. Record exact app, recipe, game, manager and tool versions. A menu launch is only one step.

## 8. Prepare publication

Complete credits, source permissions, support instructions, truthful screenshots and the release checklist. Featured status indicates Loadstone maintenance, not endorsement by upstream authors or publishers. Publication remains a separate action after the [acceptance gates](../../docs/1.0-plan.md) are met.

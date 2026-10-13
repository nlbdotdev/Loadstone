# Guided native installation

In the live workspace, **Discover → Open .loadstone** imports a native package and guides the player through its required inputs. A private-inputs JSON file is no longer required for this desktop path. The creator workflow in Settings and the local-only CLI remain available.

1. Review the package name, version, creator and save guidance. Loadstone validates the complete package before displaying the setup.
2. Select each required owned game. One detected Steam installation matching the declared game and store is selected automatically; ambiguous results require a choice. Detected folders are suggestions, and required file hashes are checked during installation. Fallout 3 for TTW and GOG installations currently require manual folder selection.
3. Select any prepared prerequisite folders. These may contain locally converted content; Loadstone checks the declared files and never runs prerequisite instructions or a converter.
4. For each archive, keep **Download from original source** or choose and verify an existing original archive. Sources are searchable and paginated. Automatic uncached Nexus downloads require a connected Premium account. [Browser-download mode](native-manual-downloads.md), the default without a known Premium connection, opens the exact Nexus file page and requires verified local selections before review. The player controls the website download; the app checks the selected file's size and SHA-256 with cancellable progress. Existing cache files can also be explicitly verified and selected. Automatic cache reuse follows the same [download rules](native-downloads.md).
5. Choose an existing installation parent, then **Review installation**. The app chooses a new child folder and shows the destination, output/storage counts, original download hosts, cache and archive reader. Select a trusted local 7-Zip x64 26.04 or newer when prompted for downloads or 7z/RAR inputs.
6. Confirm **Install native setup**. Downloads shows acquisition, source checks, reconstruction and final verification, with cancellation and persistent history. Starting from this screen uses the same [native builder](native-reconstruction.md) and output checks as the creator workflow.
7. After **Files verified · Launch untested**, choose **Review for My library**. Loadstone verifies that exact job destination and its portable MO2 launch layout again, then asks whether to add it. Cancellation adds nothing. Acceptance opens My library, where launch and optional Desktop/Steam shortcut controls are available. This step starts no game, imports no saves and creates no shortcuts automatically.

Packages without the required portable MO2 layout can reconstruct files but cannot pass library admission. A recipe's declared save compatibility is creator guidance, not a gameplay certification. Complete source permissions, clean-machine/provider acceptance and real game/save/client checks remain release gates.

**My library → Install another version** uses this flow for a [separate version update](native-updates.md). The original setup stays in its folder with its existing saves, settings and shortcuts; the selected version gets fresh recipe settings and a separate library admission.

## Recovery and privacy

For a cancelled, failed or interrupted installation, **Downloads → Review resume** asks for the same package and returns to the guided selections. Reselect local inputs; the installation parent is fixed to the original job. Review shows matching, missing and conflicting files and the recovery folder, with cancellable retained-file checking. Confirmation uses the existing [build recovery](native-build-recovery.md), retaining conflicts and reusing matching outputs under the same history record and destination.

Selected game, prerequisite and archive paths appear locally in the renderer so the player can review them. The private map and package path stay in the main process; no raw path map is accepted from renderer IPC. Detected folders use opaque per-import identifiers, and every selection is restricted to inputs declared by the recipe. Selection changes invalidate a reviewed plan. Import cancellation preserves the current selections but requires a fresh review.

The draft survives navigation while Loadstone remains open and is discarded on restart. It is not saved to history or diagnostic exports. Builds retain their existing destination/progress/history records, and source inputs must be selected again for recovery. Opening or reviewing a package does not download archives. Starting an installation explicitly allows its reviewed original-source acquisition; credentials retain the existing Nexus isolation.

## Verification

Service tests exercise required selections, ambiguous detection, invalid/stale identifiers, redirected folders, recipe replacement, concurrent selection rejection, cancellation/restart/resume, and local/downloaded archive paths through the shared builder. An actual Electron test exercises Discover import without JSON, Downloads cancellation/resume, explicit library admission cancellation/confirmation and restart persistence. All test game/tool bytes and provider responses are synthetic; no fixture executable is run and no real Desktop or Steam library is written.

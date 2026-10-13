# Privacy and local data

This describes the current source preview, not a future cloud service. Loadstone has no analytics SDK, advertising, automatic crash upload or Loadstone-hosted account service. It does not upload diagnostics automatically.

## Local storage

Packaged app settings and workspace data live in `%APPDATA%\Loadstone`. They include chosen folder paths, imported manifest metadata and source locations, demo state, live installation history, bounded engine output, shortcut locations, and local Steam account identifiers used for saved entries. Test builds can select another app-data directory through `LOADSTONE_DATA_DIR`.

`nexus.bin` contains the key and validated account metadata encrypted through Electron safeStorage/Windows DPAPI. Public status exposes the display name, Premium flag and verification time; the key remains in the main process. Disconnect removes Loadstone's credential files. It does not revoke the provider key or change Wabbajack's account. Same-user software can potentially access credentials; encryption is not a defense against malware in the same Windows account.

Experimental native creator builds store their recipe fingerprint, destination, progress and status in `native-builds.json`. Candidate folders contain their recipe snapshot and reconstruction receipt. The selected private local-inputs JSON remains where you created it; its game/archive paths are read into the main process for the build, not copied into history or sent to the renderer. Native build records are currently excluded from diagnostic exports. Cancelled or interrupted folders remain on disk for review.

When a reviewed native build requests original-source downloads, completed archives remain in `native-downloads/` beneath app data for verified reuse. Original hostnames and the cache directory appear in the build review. Signed links, API keys and provider response bodies are not stored in build history or diagnostics. A hard process interruption may leave temporary `.part` files; they are never reused as verified archives. Resetting demo data does not clear this cache.

Installation destinations contain the list snapshot, downloaded archives, MO2 output and engine logs. Steam shortcut backups remain beside Steam's `shortcuts.vdf`. Desktop links point to the installed manager. Resetting demo data does not remove those files or live installations. Library removal retains profiles, saves folders, overwrite files, MO2 settings, downloads and files outside the profile directory in a sibling recovery folder. Other profile files, including custom mods, are deleted only after the removal dialog is accepted. See [removal behavior](installation.md#removing-a-setup) before manually deleting retained data.

## Network activity

Account connection and explicit revalidation contact Nexus Mods. Installation preflight also revalidates access when Nexus downloads are needed. Preparing the engine downloads the pinned official release from GitHub and its download infrastructure. Wabbajack performs list downloads and may contact Nexus, original file hosts and its own supporting services; those providers control their own logging and privacy practices. Local game discovery reads Steam metadata and the Windows Steam registry path. Steam shortcut editing operates on local files.

Explicitly starting a native build with requested downloads contacts the original public HTTPS hosts and their permitted redirect destinations. Uncached Nexus sources trigger account verification and specific file download-link requests; keys go only to the Nexus API. Original providers receive the connection's IP address and Loadstone's application identification. Merely opening Settings or inspecting a native package does not start archive downloads. See [native download handling](native-downloads.md).

## Diagnostics

The Settings export is a structured JSON summary containing app/build identity, platform/runtime versions, preferences, connection status, aggregate demo counts, and up to 25 recent live job summaries. It excludes credentials, account names/IDs, filesystem paths, creator metadata, source URLs and raw logs. Errors are reduced to automatic categories and numeric exit codes; these are triage hints, not diagnoses. The save dialog writes only to the selected local destination and does not upload the report.

Paths, setup names, account display names and local account IDs can identify a user. Review any exported or copied diagnostics before sharing. Loadstone redacts the known API key, query strings and common token fields from captured engine output, but this is not a guarantee that arbitrary third-party output contains no personal data. Native engine logs may be unsanitized during a run or after a crash. Do not share credential files, raw Steam account files or complete user-data folders.

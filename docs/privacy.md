# Privacy and local data

This describes the current source preview, not a future cloud service. Loadstone has no analytics SDK, advertising, automatic crash upload or Loadstone-hosted account service. It does not upload diagnostics automatically.

## Local storage

Packaged app settings and workspace data live in `%APPDATA%\Loadstone`. They include chosen folder paths, imported manifest metadata and source locations, demo state, live installation history, bounded engine output, shortcut locations, and local Steam account identifiers used for saved entries. Test builds can select another app-data directory through `LOADSTONE_DATA_DIR`.

`nexus.bin` contains the key and validated account metadata encrypted through Electron safeStorage/Windows DPAPI. Public status exposes the display name, Premium flag and verification time; the key remains in the main process. Disconnect removes Loadstone's credential files. It does not revoke the provider key or change Wabbajack's account. Same-user software can potentially access credentials; encryption is not a defense against malware in the same Windows account.

Installation destinations contain the list snapshot, downloaded archives, MO2 output and engine logs. Steam shortcut backups remain beside Steam's `shortcuts.vdf`. Desktop links point to the installed manager. Resetting demo data does not remove those files or live installations. Save-safe removal is still in development; do not delete an installation folder without preserving your saves and custom changes.

## Network activity

Account connection and explicit revalidation contact Nexus Mods. Installation preflight also revalidates access when Nexus downloads are needed. Preparing the engine downloads the pinned official release from GitHub and its download infrastructure. Wabbajack performs list downloads and may contact Nexus, original file hosts and its own supporting services; those providers control their own logging and privacy practices. Local game discovery reads Steam metadata and the Windows Steam registry path. Steam shortcut editing operates on local files.

## Diagnostics

Paths, setup names, account display names and local account IDs can identify a user. Review any exported or copied diagnostics before sharing. Loadstone redacts the known API key, query strings and common token fields from captured engine output, but this is not a guarantee that arbitrary third-party output contains no personal data. Native engine logs may be unsanitized during a run or after a crash. Do not share credential files, raw Steam account files or complete user-data folders.

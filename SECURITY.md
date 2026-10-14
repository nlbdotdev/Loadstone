# Security reporting

Loadstone is under active development. Only current `main` is being developed; there is no supported public stable release or guaranteed response time yet. The published v0.1.0 demo is historical.

This source repository is public. GitHub private vulnerability reporting is not currently enabled, and a monitored confidential contact has not yet been published. Until a private reporting route is listed here, open an issue requesting a private contact without including vulnerability details. Do not post secrets, personal files or exploit details in public issues. Establishing the confidential reporting channel remains a release requirement.

Once a confidential channel is established, include the affected commit/version, Windows version, reproducible steps using synthetic data, expected and observed behavior, and impact in the private report. Do not include Nexus keys, encrypted credential files, personal Steam files, game assets or unreviewed logs. If a credential was exposed, revoke it at its provider rather than relying on deletion from a report.

## Boundaries

The renderer is sandboxed with context isolation and a limited IPC bridge. The main process controls files, credentials and child processes. SHA-256 pins check the engine and imported archive; ownership markers restrict installation recovery and shortcut edits. These controls do not establish that a third-party modlist is trustworthy. Installed mod managers, plugins and games execute as the Windows user. Use trusted creators and original sources.

Windows credential encryption protects against other accounts, not malware running as the same user. Engine log sanitization happens after the child exits; crashes can leave unsanitized native logs. See [privacy](docs/privacy.md) and [installation limits](docs/installation.md).

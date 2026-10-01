# Security reporting

Loadstone is an unreleased private preview. Only current `main` is being developed; there is no supported public stable release or guaranteed response time yet.

For a suspected vulnerability, contact the repository owner through the private channel used to obtain access. Do not post secrets or exploit details in public issues. Before publication, the maintainer must enable GitHub private vulnerability reporting or publish a monitored private contact. That public reporting gate is still open.

Include the affected commit/version, Windows version, reproducible steps using synthetic data, expected and observed behavior, and impact. Do not include Nexus keys, encrypted credential files, personal Steam files, game assets or unreviewed logs. If a credential was exposed, revoke it at its provider rather than relying on deletion from a report.

## Boundaries

The renderer is sandboxed with context isolation and a limited IPC bridge. The main process controls files, credentials and child processes. SHA-256 pins check the engine and imported archive; ownership markers restrict installation recovery and shortcut edits. These controls do not establish that a third-party modlist is trustworthy. Installed mod managers, plugins and games execute as the Windows user. Use trusted creators and original sources.

Windows credential encryption protects against other accounts, not malware running as the same user. Engine log sanitization happens after the child exits; crashes can leave unsanitized native logs. See [privacy](docs/privacy.md) and [installation limits](docs/installation.md).

# Glossary

| Term | Meaning in Loadstone |
| --- | --- |
| Admission | Explicit review and registration of a verified candidate in My library. |
| Archive candidate | A possible original download identified by metadata or creator hints; not yet a proven source. |
| BSA | A Bethesda resource container. Current native inspection/reconstruction supports a bounded version-104 subset. |
| Candidate | A newly reconstructed installation folder awaiting verification, admission or gameplay acceptance. |
| Corresponding source | The source and build material required by the applicable software license for a distributed build. |
| Direct match | An exact installed file found as a member of an original archive. |
| Fingerprint | The file's expected byte count and SHA-256 content hash. |
| Inventory | A record of the selected installed setup, including file identities and mod/profile state. |
| Ledger | Private evidence linking an inventory to possible and verified original sources. |
| Manifest | A catalog description for the separate external-engine installation path. |
| MO2 | Mod Organizer 2, an external manager used by supported portable profile layouts. |
| Native package | A `.loadstone` package interpreted by Loadstone's own typed reconstruction engine. |
| Nested match | A verified original archive → container → inner-file source chain. |
| Original archive | The exact upstream download locked by a recipe or ledger. |
| Prepared prerequisite | A local folder of declared required files; the app checks it without executing a converter. |
| Profile | The selected mod order, plugins, settings and save-isolation configuration for a setup. |
| Recipe | The declarative requirements, sources, outputs and typed actions for a native package. |
| Receipt | Durable evidence of a build/maintenance operation; incomplete receipts do not certify a complete setup. |
| Recovery folder | Retained originals or protected content from an interrupted or reviewed maintenance operation. |
| TTW | Tale of Two Wastelands, a conversion with its own source-game and distribution requirements. |
| Wabbajack | An external modlist installation engine; its integration is separate from native `.loadstone` reconstruction. |

For the full workflow, read [How Loadstone works](concepts.md).

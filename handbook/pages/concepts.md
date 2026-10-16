# How Loadstone works

Loadstone brings source selection, reconstruction, verification and a playable library into one desktop workflow. The app keeps these steps explicit so a failed download, a locally edited file and an untested game launch are not mistaken for the same problem.

## Native packages and external manifests

A **native `.loadstone` package** uses Loadstone's documented experimental recipe format. Its actions are typed file operations, with declared sizes and hashes. It can refer to original downloads, owned games and prepared prerequisites, and may include permitted payloads. See the [format reference](../../docs/loadstone-format.md).

A **live catalog manifest** belongs to the separate external-engine path. Wabbajack integration prepares and runs a verified external runtime; it does not turn any file with a familiar extension into a supported native package. See [manifest requirements](../../docs/manifests.md) and the [runtime guide](../../docs/runtime.md).

## From source to library

**Sources → reviewed plan → candidate → verification → admission → launch.**

Sources are locked inputs. A plan checks prerequisites and a separate destination. The builder creates a candidate and checks every required output. Admission reviews that completed candidate before creating a library entry. Launch uses its declared manager/profile configuration. Desktop and Steam shortcuts are explicit operations associated with that setup.

## Exact bytes and local state

A SHA-256 fingerprint plus a byte count identifies the expected file content. Some outputs also require a declared modification time, because game tooling may use timestamps for ordering. File verification does not compare visual similarity or assume that a newer mod download is interchangeable with the pinned original.

Save files, user settings and unexpected files are a different kind of state. Maintenance must preserve them according to the reviewed operation. Restoring recipe configuration is a separate repair choice because it can replace deliberate local settings.

## Sources inside sources

A loose file can originate inside a BSA container inside an original ZIP, 7z or RAR download. Native BSA reconstruction records every link in that chain. The [creator mapper](../../docs/bsa-inspection.md#nested-source-mapping) checks those links before recording a match. Arbitrary nested installers and generated transformations are not implied by BSA support.

## Evidence and permission

An installed inventory says what is present. A source match says where the exact bytes can be obtained. A recipe says how to produce the output. A rights review says what can be distributed. Acceptance says whether the result works in the intended environment. None of these replaces the others.

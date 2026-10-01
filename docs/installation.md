# Live installation preview

Disable dummy data in Settings, prepare the pinned engine, connect a Nexus account if the list requires it, then import a creator manifest with its original Wabbajack archive. Check compatibility in Discover. Installation becomes available only after all checks pass; starting repeats the checks. Wabbajack must resolve the same game folder selected in Loadstone. Lists requiring unsupported providers or manual Nexus downloads are blocked.

Only one live installation runs at a time. Downloads displays actual engine output and job phases, without estimating a percentage from elapsed time. Library entries appear after the engine exits successfully and structural profile verification passes. This checks the manager executable, configuration, declared profile and launch target. It does not prove every installed file's hash or that the game plays correctly. Launch and shortcut controls are still being implemented.

## Owned files and recovery

The selected destination must initially be empty. Loadstone records an ownership marker and creates `profile/` for Wabbajack output, `downloads/` for reusable archives, `work/` for the engine working directory, and a hashed `list.wabbajack` snapshot. Retry requires matching ownership and preserves downloads and partial output. It also repeats preflight against the imported manifest and source archive; keep those available. Changed source manifests may prevent a retry of the original snapshot.

Cancel stops the tracked engine process tree. Completion is recorded only after the child exits. An unexpected app interruption leaves a durable job that becomes interrupted on reopening. Restart Windows before retrying that job: the saved Windows boot identifier prevents reuse while the previous engine might still be running. Loadstone does not automatically restart interrupted work.

## Credentials and diagnostics

The main process passes the private-test Nexus key only to the engine environment. Renderer job history contains no key. Captured output redacts the exact key, URL queries and named token fields, retaining at most 150 lines of 1,000 characters each. After the child exits, matching Wabbajack CLI logs in the owned working directory are sanitized; oversized logs are replaced with a short notice. Native engine logs may remain unsanitized while installation is running or after a crash. Do not publish raw engine logs without reviewing them. Third-party diagnostics outside that working directory are not covered by this sanitizer.

## Verification status

Tests exercise real child processes with synthetic files: success, failure, cancellation, retry, ownership rejection, restart recovery and credential redaction. The pinned official engine has separately passed integrity, version, help and game discovery checks. A full real list download, install and play session has not yet passed acceptance testing. These source features are newer than the v0.1.0 portable preview.

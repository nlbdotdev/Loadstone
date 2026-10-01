# Nexus account integration

The private testing build accepts a personal Nexus API key in Settings. It validates the key with `https://api.nexusmods.com/v1/users/validate.json`, identifying itself with `Application-Name: Loadstone` and the package version. It does not imitate another registered application. Public distribution requires the Nexus registration workflow described in the [API acceptable-use policy](https://help.nexusmods.com/article/114-api-acceptable-use-policy).

Only the account display name, Premium flag and verification timestamp are returned to the renderer. Email, avatar, and other response fields are discarded. The key and account metadata are saved together in `nexus.bin`, encrypted with Electron safeStorage. On Windows this uses DPAPI; it protects against other Windows accounts, not other processes running as the same user. No plaintext storage fallback is used. See [Electron's storage semantics](https://www.electronjs.org/docs/latest/api/safe-storage).

Account validation is explicitly requested by the user, with a 15-second timeout, redirects disabled, a bounded response, and clear handling for invalid/revoked keys, rate limits and unavailable service. Opening Settings reads local status without making an API request. Cached account status is labeled with its verification time; it is not proof of current download entitlement. Failed validation or persistence keeps the previous saved connection. Disconnect removes Loadstone's credential files without changing another application's credentials or revoking the key on Nexus.

## Validation and remaining work

Automated tests use synthetic keys and controlled responses. They cover account rejection, rate limits, unavailable encryption, malformed responses, secret-free public status/errors, failed-save preservation and disconnect. The Electron test uses real Windows encryption, verifies the resulting file does not contain the key, and restores account status after restart. No real Nexus account has been validated in this milestone.

The installation runner supplies the key through the child process's `NEXUS_API_KEY` environment variable, never command arguments. It clears inherited Nexus credential environment variables first. The released engine prefers its own saved login, so preflight checks for that credential file and blocks installation until the user signs out in Wabbajack. Loadstone does not read or alter that file. This handoff is covered with synthetic process tests; it still needs a real Nexus installation acceptance run.

Automatic Nexus downloads require freshly verified Premium access. Free accounts need a manual-download flow, which is not implemented yet. See [installation behavior](installation.md) for log handling and recovery limits.

Child-process environments remove inherited Nexus API-key and OAuth variables case-insensitively, including mixed-case Windows names. Only the installer receives the explicitly selected Loadstone key; engine probes and profile launches receive neither inherited variable. A synthetic real-child regression test covers this boundary without accessing a real account. See [Node's Windows environment behavior](https://nodejs.org/api/child_process.html).

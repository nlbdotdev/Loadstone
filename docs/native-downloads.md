# Original-source archive downloads

The experimental desktop native builder can acquire `https-archive` and `nexus-archive` sources from a reviewed `.loadstone` package. [Guided installation](native-guided-install.md) defaults each archive to its original download and offers a native picker for manually downloaded originals. The creator workflow uses a private input map with either an absolute local archive path or `null` for each archive source ID:

```json
{
  "games": { "fnv": "C:/OwnedGames/Fallout New Vegas" },
  "archives": { "original-mod": null, "manual-mod": "C:/ModDownloads/manual.zip" }
}
```

The source IDs, lengths, hashes and public source references come from the recipe. The private map cannot substitute download URLs, credentials or executables. Games and local prerequisites still require prepared local folders. The CLI remains local-only.

## Review and execution

Both guided Discover review and creator Settings review show the archive count, maximum acquisition bytes, original source hostnames, local cache directory and selected archive tool before confirmation. No downloads occur during selection or package inspection. Starting re-inspects the package and rejects a changed recipe before network work. The materializer checks the same recipe fingerprint again before creating candidate outputs.

The builder acquires archives sequentially, then runs the existing complete input, archive-structure, write and final-file verification. Archive signatures select the actual parser. Acquisition is a separate progress phase; current-file bytes represent downloaded bytes or bytes rehashed from cache. Cancellation and the app close guard include acquisition.

The tool picker is required when any download is requested because its archive type has not yet been inspected. ZIP downloads use the built-in reader; 7z/RAR use the explicitly selected and fingerprinted local tool. No external tool is downloaded automatically.

## Cache and retry

The cache is `native-downloads/` beneath Loadstone's app-data directory. Completed archives use their SHA-256 as the filename. Each new download streams through an exclusive random `.part` file, enforcing the recipe byte length and hash before exclusive publication into the cache. A conflicting cache file is not replaced. Existing archives are rehashed before reuse; mismatches fail and preserve the file for inspection.

The builder checks for the expected archive bytes plus a 64 MB free-space reserve before each download. Archives remain bounded to 50 GB. Connections have a 30-second header/idle timeout and an acquisition attempt has a two-hour deadline. There is no automatic network retry or concurrent transfer. These are current creator-tool limits, not throughput promises.

Cancellation or a handled error removes only the current owned temporary download when its directory/file identity still matches. Verified archives remain for retry. A process kill can leave an orphan `.part` file; it is never treated as verified. Retrying reuses verified cached archives but restarts incomplete downloads from byte zero. The desktop can [review and resume a partial candidate](native-build-recovery.md), reusing matching output files and retaining conflicting files before reconstruction. Byte-range download resume, cache management and global cache quotas remain unfinished.

## Network and account handling

Original HTTPS downloads use port 443, normal TLS certificate/hostname validation and no cookies, browser session, proxy credentials or inherited authorization headers. Redirects are limited to five and each destination is revalidated. Local, private, link-local, multicast, documentation and other reserved IP ranges are rejected, including mixed public/private DNS answers. IPv6 is conservatively limited to global unicast excluding special ranges. The connection is pinned to a checked DNS answer while retaining the original hostname for TLS validation. This intentionally rejects some specialized networks; it does not add an unrestricted network proxy.

For an uncached Nexus source, the builder freshly verifies the locally protected account and requires Premium. It calls the specific game/mod/file download-link API, identifying Loadstone and its version. API redirects are refused. The key goes only to the fixed Nexus API origin; the returned HTTPS download link is used in memory without API headers, then discarded. Link responses are bounded to 128 KB. Free users can download through Nexus themselves and select the resulting archive; NXM/browser-guided free downloads are still unfinished. A verified local cache hit requires neither a key nor an API request.

Build history, diagnostics and progress contain no API key, signed URL, response body or raw network error. Source hostnames are shown only in the reviewed plan. Safe errors identify account verification, Premium access, rate limits, hash mismatch or cache/network failure. HTTP failures and rate limits stop the attempt rather than repeatedly calling the provider.

Sources checked October 13, 2026: [Nexus API policy](https://help.nexusmods.com/article/114-api-acceptable-use-policy), [Nexus download-link interface](https://github.com/Nexus-Mods/node-nexus-api/blob/master/src/Nexus.ts), [Node HTTPS](https://nodejs.org/api/https.html), [IANA IPv4 special ranges](https://www.iana.org/assignments/iana-ipv4-special-registry), [IANA IPv6 special ranges](https://www.iana.org/assignments/iana-ipv6-special-registry). This implementation is original code; no provider client code is incorporated.

## Acceptance boundary

Synthetic tests exercise exact cache bytes, rehash/reuse, hash/length failures, disconnect/cancellation, credential separation, Premium restrictions, redirects and DNS policy. The actual Electron bridge exercises reviewed acquisition through a controlled network response into archive extraction and final verification. A controlled response is not evidence that a real Nexus account, registration or real mod download has passed acceptance. Real provider, clean-machine and gameplay checks remain required. Downloads do not establish permission to mirror or bundle their contents.

A separate private real-network check downloaded the existing pinned 7-Zip 26.04 x64 test dependency from its original GitHub release through the production client. Its 1,664,082 bytes matched SHA-256 `d54bf805f9f3704d1e8db2fa3498ae7ef2df0312b40b558e7c71c734430a665d`, and a second acquisition reused the verified cache with network requests disabled. The downloaded executable was not run or bundled. This checks real HTTPS/redirect delivery and exact cache reuse; it does not certify Nexus access or a playable installation.

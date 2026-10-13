const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yauzl = require('yauzl');
const { relativeFile } = require('./manifest.cjs');
const { ordinaryFile, sameFile } = require('./native-package.cjs');
const { inspectSevenZipMembers } = require('./sevenzip.cjs');
const { archiveKind } = require('./archive-kind.cjs');
const { recordArchiveMatch } = require('./archive-matches.cjs');

async function inspectZipMembers(candidate, wanted, signal) {
  signal?.throwIfAborted();
  const before = ordinaryFile(candidate.archive, 50_000_000_000);
  const archiveHash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(candidate.archive)) {
    signal?.throwIfAborted();
    archiveHash.update(chunk);
  }
  if (
    before.size !== candidate.bytes ||
    archiveHash.digest('hex') !== candidate.sha256
  )
    throw new Error('Cached archive differs from the ledger fingerprint.');
  const sizes = new Set([...wanted].map((v) => Number(v.split(':')[0])));
  const zip = await yauzl.openPromise(candidate.archive, {
    lazyEntries: true,
    autoClose: false,
    validateEntrySizes: true,
    strictFileNames: true,
  });
  const paths = new Map(),
    matches = new Map();
  let total = 0,
    scanned = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      signal?.throwIfAborted();
      const folder = entry.fileName.endsWith('/'),
        name = folder ? entry.fileName.slice(0, -1) : entry.fileName;
      const type = (entry.externalFileAttributes >>> 16) & 0o170000,
        key = name.toLowerCase();
      if (
        !relativeFile(name) ||
        name.includes('\\') ||
        name !== name.normalize('NFC') ||
        paths.has(key) ||
        (type && type !== (folder ? 0o040000 : 0o100000)) ||
        entry.generalPurposeBitFlag & 1
      )
        throw new Error(
          'Archive contains unsafe, duplicate, redirected or encrypted entries.',
        );
      paths.set(key, folder ? 'directory' : 'file');
      total += entry.uncompressedSize;
      if (paths.size > 500000 || total > 100_000_000_000)
        throw new Error('Archive member inventory exceeds limits.');
      if (folder || !sizes.has(entry.uncompressedSize)) continue;
      if (
        entry.uncompressedSize > 1_000_000_000 ||
        scanned + entry.uncompressedSize > 20_000_000_000
      )
        throw new Error('Archive member hashing exceeds limits.');
      const stream = await zip.openReadStreamPromise(entry),
        hash = crypto.createHash('sha256');
      let bytes = 0;
      for await (const chunk of stream) {
        signal?.throwIfAborted();
        bytes += chunk.length;
        if (bytes > entry.uncompressedSize) {
          stream.destroy();
          throw new Error('Archive member exceeds declared size.');
        }
        hash.update(chunk);
      }
      scanned += bytes;
      const identity = `${bytes}:${hash.digest('hex')}`;
      if (wanted.has(identity)) recordArchiveMatch(matches, identity, name);
    }
    for (const name of paths.keys()) {
      const parts = name.split('/');
      while (parts.length > 1) {
        parts.pop();
        if (paths.get(parts.join('/')) === 'file')
          throw new Error('Archive file and directory paths overlap.');
      }
    }
  } finally {
    zip.close();
  }
  if (!sameFile(before, ordinaryFile(candidate.archive, 50_000_000_000)))
    throw new Error('Archive changed during member inspection.');
  return matches;
}

async function mapArchiveSources(ledger, options = {}) {
  if (
    ledger?.kind !== 'loadstone-source-ledger' ||
    ledger.schemaVersion !== 1 ||
    !Array.isArray(ledger.mods) ||
    ledger.mods.length > 10000
  )
    throw new Error('Use a supported source ledger.');
  const result = structuredClone(ledger),
    archiveGroups = new Map();
  let fileCount = 0;
  for (const mod of result.mods) {
    if (
      !Array.isArray(mod.installedFiles) ||
      !Array.isArray(mod.archiveCandidates)
    )
      throw new Error('Invalid ledger mod records.');
    fileCount += mod.installedFiles.length;
    if (fileCount > 1000000)
      throw new Error('Too many installed ledger files.');
    for (const file of mod.installedFiles) {
      if (
        !relativeFile(file.path) ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(file.sha256)
      )
        throw new Error('Invalid installed file fingerprint.');
      file.sourceMatches = [];
    }
    if (mod.separator || !mod.installedFiles.length) continue;
    for (const candidate of mod.archiveCandidates) {
      if (
        !candidate ||
        typeof candidate.archive !== 'string' ||
        !path.isAbsolute(candidate.archive) ||
        !Number.isSafeInteger(candidate.bytes) ||
        candidate.bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(candidate.sha256)
      )
        throw new Error('Invalid archive candidate fingerprint.');
      if (candidate.metadataConflict) continue;
      const key = candidate.archive.toLowerCase();
      const group = archiveGroups.get(key) || { candidate, mods: new Set() };
      if (
        group.candidate.sha256 !== candidate.sha256 ||
        group.candidate.bytes !== candidate.bytes
      )
        throw new Error('Conflicting fingerprints for one archive path.');
      group.mods.add(mod);
      archiveGroups.set(key, group);
      if (archiveGroups.size > 100000)
        throw new Error('Too many candidate archives.');
    }
  }
  const inspected = [],
    issues = [];
  let matchReferences = 0;
  for (const { candidate, mods } of archiveGroups.values()) {
    options.signal?.throwIfAborted();
    const wanted = new Set(
      [...mods].flatMap((mod) =>
        mod.installedFiles
          .filter((file) => file.path.toLowerCase() !== 'meta.ini')
          .map((file) => `${file.bytes}:${file.sha256}`),
      ),
    );
    try {
      const kind = archiveKind(candidate.archive);
      if (kind !== 'zip' && !options.sevenZip)
        throw new Error('Select a trusted archive tool for 7z/RAR comparison.');
      const matched =
        kind === 'zip'
          ? await inspectZipMembers(candidate, wanted, options.signal)
          : await inspectSevenZipMembers(
              candidate,
              wanted,
              options.sevenZip,
              options.signal,
            );
      let proposed = 0;
      for (const mod of mods)
        for (const file of mod.installedFiles) {
          if (file.path.toLowerCase() !== 'meta.ini')
            proposed += matched.has(`${file.bytes}:${file.sha256}`) ? 1 : 0;
        }
      if (matchReferences + proposed > 500000)
        throw new Error('Mapping exceeds the match-reference limit.');
      for (const mod of mods)
        for (const file of mod.installedFiles) {
          if (file.path.toLowerCase() === 'meta.ini') continue;
          const match = matched.get(`${file.bytes}:${file.sha256}`);
          if (match) {
            if (
              !file.sourceMatches.some(
                (v) =>
                  v.archiveSha256 === candidate.sha256 &&
                  v.member === match.member,
              )
            )
              file.sourceMatches.push({
                archiveSha256: candidate.sha256,
                member: match.member,
                equivalentMembers: match.equivalentMembers,
              });
          }
        }
      matchReferences += proposed;
      inspected.push({ archive: candidate.archive, sha256: candidate.sha256 });
    } catch (error) {
      options.signal?.throwIfAborted();
      // The report is private, but errors still avoid raw library/OS text that
      // can include arbitrary archive content or other machine information.
      issues.push({
        archive: candidate.archive,
        reason:
          'Archive could not be verified safely; no member matches accepted.',
      });
    }
    options.progress?.({
      phase: 'archives',
      inspected: inspected.length,
      issues: issues.length,
    });
  }
  const files = result.mods.flatMap((mod) => mod.installedFiles);
  result.mapping = {
    kind: options.sevenZip ? 'archive-member-sha256' : 'zip-member-sha256',
    memberSelection: 'lexicographic-representative-per-content',
    ...(options.sevenZip ? { sevenZipVersion: options.sevenZip.version } : {}),
    inspected,
    issues,
    matchedInstalledFiles: files.filter((file) => file.sourceMatches.length)
      .length,
    unmatchedInstalledFiles: files.filter((file) => !file.sourceMatches.length)
      .length,
  };
  result.installable = false;
  result.publicationApproved = false;
  result.blockers = [
    'Only exact matches in safely inspected archive candidates are recorded; unsupported archives and unmatched files remain unresolved.',
    'Local MO2 metadata is intentionally excluded from archive matching and needs safe regeneration.',
    'Root/game files, profile reconstruction, local edits and generated content require further mapping.',
    'A byte match does not establish credits, permissions, save compatibility or gameplay acceptance.',
  ];
  return result;
}
module.exports = { mapArchiveSources, mapZipSources: mapArchiveSources };

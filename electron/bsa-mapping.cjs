const fs = require('node:fs');
const path = require('node:path');
const { relativeFile } = require('./manifest.cjs');
const { ordinaryFile, sameFile } = require('./native-package.cjs');
const { archiveKind } = require('./archive-kind.cjs');
const { inspectZipMembers } = require('./archive-mapping.cjs');
const { inspectSevenZipMembers } = require('./sevenzip.cjs');
const { inspectBsa104, limits } = require('./bsa104.cjs');
const { recordArchiveMatch } = require('./archive-matches.cjs');

const fingerprint = (v) =>
  v &&
  Number.isSafeInteger(v.bytes) &&
  v.bytes >= 0 &&
  typeof v.sha256 === 'string' &&
  /^[a-f0-9]{64}$/.test(v.sha256);
const safeName = (name) =>
  typeof name === 'string' &&
  relativeFile(name) &&
  !name.includes('\\') &&
  name === name.normalize('NFC');
const identity = (v) => `${v.bytes}:${v.sha256}`;
function demand(ok, message) {
  if (!ok) throw new Error(`BSA mapping: ${message}`);
}

// Installed containers are read-only witnesses. Rehashing their original
// archive members establishes the source chain without temporary extraction.
async function mapBsaSources(ledger, options = {}) {
  options.signal?.throwIfAborted();
  demand(
    ledger?.kind === 'loadstone-source-ledger' &&
      ledger.schemaVersion === 1 &&
      Array.isArray(ledger.mods) &&
      ledger.mods.length <= 10000,
    'use a supported source ledger.',
  );
  demand(
    Array.isArray(options.containerMods) &&
      options.containerMods.length > 0 &&
      options.containerMods.length <= limits.containers &&
      options.containerMods.every((v) => safeName(v) && !v.includes('/')) &&
      new Set(options.containerMods.map((v) => v.toLowerCase())).size ===
        options.containerMods.length,
    'select distinct inventoried container mods.',
  );
  demand(
    typeof options.modsFolder === 'string' &&
      path.isAbsolute(options.modsFolder),
    'select the inventoried mods directory.',
  );
  const root = path.resolve(options.modsFolder),
    rootStat = fs.lstatSync(root);
  const guardRoot = () => {
    const stat = fs.lstatSync(root);
    demand(
      stat.isDirectory() &&
        !stat.isSymbolicLink() &&
        stat.ino === rootStat.ino &&
        stat.dev === rootStat.dev &&
        fs.realpathSync(root).toLowerCase() === root.toLowerCase(),
      'mods directory changed or is redirected.',
    );
  };
  guardRoot();
  const result = structuredClone(ledger),
    names = new Set(),
    files = [],
    containers = [],
    archives = new Map(),
    wanted = new Map();
  for (const mod of result.mods) {
    demand(
      safeName(mod.name) &&
        !mod.name.includes('/') &&
        !names.has(mod.name.toLowerCase()) &&
        Array.isArray(mod.installedFiles) &&
        Array.isArray(mod.archiveCandidates) &&
        mod.archiveCandidates.length <= 100000,
      'invalid mod records.',
    );
    names.add(mod.name.toLowerCase());
    const paths = new Set();
    for (const file of mod.installedFiles) {
      demand(
        safeName(file.path) &&
          !paths.has(file.path.toLowerCase()) &&
          fingerprint(file) &&
          (file.sourceMatches === undefined ||
            Array.isArray(file.sourceMatches)),
        'invalid installed file records.',
      );
      paths.add(file.path.toLowerCase());
      file.bsaSourceMatches = [];
      files.push(file);
      demand(files.length <= 1000000, 'too many installed files.');
      if (
        mod.separator ||
        mod.unmanaged ||
        file.path.toLowerCase() === 'meta.ini'
      )
        continue;
      const matches = wanted.get(identity(file)) || [];
      matches.push(file);
      wanted.set(identity(file), matches);
    }
    if (!options.containerMods.includes(mod.name)) continue;
    demand(!mod.separator && !mod.unmanaged, 'container mod must be managed.');
    const selected = mod.installedFiles.filter((v) => /\.bsa$/i.test(v.path));
    demand(selected.length > 0, 'selected mod has no inventoried BSA files.');
    for (const file of selected) {
      demand(
        file.bytes >= 36 && file.bytes <= limits.archiveBytes,
        'container exceeds reader limits.',
      );
      containers.push({
        mod: mod.name,
        record: file,
        file: path.join(root, mod.name, file.path),
        chains: [],
      });
    }
    for (const candidate of mod.archiveCandidates) {
      demand(
        fingerprint(candidate) &&
          typeof candidate.archive === 'string' &&
          path.isAbsolute(candidate.archive) &&
          !/[\x00-\x1f]/.test(candidate.archive),
        'invalid archive candidate.',
      );
      if (candidate.metadataConflict) continue;
      const key = path.resolve(candidate.archive).toLowerCase(),
        group = archives.get(key) || { candidate, selected: new Set() };
      demand(
        identity(group.candidate) === identity(candidate),
        'conflicting archive fingerprints.',
      );
      for (const file of selected) group.selected.add(identity(file));
      archives.set(key, group);
      demand(
        archives.size <= 1000,
        'too many candidate archives for BSA mapping.',
      );
    }
  }
  demand(
    options.containerMods.every((name) =>
      result.mods.some((v) => v.name === name),
    ),
    'container mod names must exactly match the ledger.',
  );
  demand(
    containers.length <= limits.containers &&
      containers.reduce((n, v) => n + v.record.bytes, 0) <= limits.stagingBytes,
    'selected containers exceed the inspection budget.',
  );
  const inspectedArchives = [],
    inspectedContainers = [],
    issues = [],
    sources = new Map();
  for (const { candidate, selected } of archives.values()) {
    options.signal?.throwIfAborted();
    try {
      const kind = archiveKind(candidate.archive);
      demand(
        kind === 'zip' || options.sevenZip,
        'select a trusted archive tool for 7z/RAR comparison.',
      );
      const before = ordinaryFile(candidate.archive, 50_000_000_000);
      const matched =
        kind === 'zip'
          ? await inspectZipMembers(candidate, selected, options.signal)
          : await inspectSevenZipMembers(
              candidate,
              selected,
              options.sevenZip,
              options.signal,
            );
      demand(
        sameFile(before, ordinaryFile(candidate.archive, 50_000_000_000)),
        'source archive changed.',
      );
      const source = {
        archive: candidate.archive,
        bytes: candidate.bytes,
        sha256: candidate.sha256,
        ...(candidate.nexus ? { nexus: candidate.nexus } : {}),
      };
      for (const item of containers) {
        if (!selected.has(identity(item.record))) continue;
        const match = matched.get(identity(item.record));
        if (!match) continue;
        // Content-addressed equivalent archive copies share one source chain.
        if (
          !item.chains.some(
            (v) =>
              v.archiveSha256 === candidate.sha256 &&
              v.container.member === match.member,
          )
        )
          item.chains.push({
            archiveSha256: candidate.sha256,
            container: {
              member: match.member,
              bytes: item.record.bytes,
              sha256: item.record.sha256,
            },
          });
      }
      inspectedArchives.push({
        archive: candidate.archive,
        sha256: candidate.sha256,
      });
      if (matched.size) sources.set(candidate.sha256, source);
    } catch {
      options.signal?.throwIfAborted();
      issues.push({
        archive: candidate.archive,
        reason:
          'Original archive could not be verified safely; no nested matches accepted from it.',
      });
    }
    options.progress?.({
      phase: 'bsa-archives',
      inspected: inspectedArchives.length,
      issues: issues.length,
    });
  }
  let logicalBytes = 0,
    references = 0;
  for (const item of containers) {
    options.signal?.throwIfAborted();
    if (!item.chains.length) {
      issues.push({
        mod: item.mod,
        path: item.record.path,
        reason: 'No exact BSA member found in verified original candidates.',
      });
      continue;
    }
    try {
      guardRoot();
      const report = await inspectBsa104(item.file, {
        expected: item.record,
        signal: options.signal,
      });
      guardRoot();
      demand(
        logicalBytes + report.totalBytes <= limits.totalBytes,
        'combined BSA content exceeds the inspection budget.',
      );
      const matched = new Map();
      for (const member of report.members)
        if (wanted.has(identity(member)))
          recordArchiveMatch(matched, identity(member), member.path);
      const proposals = [];
      for (const [key, match] of matched)
        for (const file of wanted.get(key))
          for (const chain of item.chains) {
            const value = {
              ...chain,
              member: match.member,
              equivalentMembers: match.equivalentMembers,
            };
            if (
              !file.bsaSourceMatches.some(
                (v) =>
                  v.archiveSha256 === value.archiveSha256 &&
                  v.container.member === value.container.member &&
                  v.member === value.member,
              )
            )
              proposals.push({ file, value });
            demand(
              references + proposals.length <= 500000,
              'nested match-reference limit exceeded.',
            );
          }
      demand(
        references + proposals.length <= 500000,
        'nested match-reference limit exceeded.',
      );
      for (const { file, value } of proposals)
        file.bsaSourceMatches.push(value);
      references += proposals.length;
      logicalBytes += report.totalBytes;
      inspectedContainers.push({
        mod: item.mod,
        path: item.record.path,
        bytes: item.record.bytes,
        sha256: item.record.sha256,
        members: report.members.length,
        totalBytes: report.totalBytes,
        matchedContent: matched.size,
      });
    } catch {
      options.signal?.throwIfAborted();
      issues.push({
        mod: item.mod,
        path: item.record.path,
        reason:
          'Installed BSA could not be verified safely within inspection limits; no matches accepted from it.',
      });
    }
    options.progress?.({
      phase: 'bsa-containers',
      inspected: inspectedContainers.length,
      issues: issues.length,
    });
  }
  options.signal?.throwIfAborted();
  guardRoot();
  result.bsaMapping = {
    kind: 'archive-bsa104-member-sha256',
    memberSelection: 'lexicographic-representative-per-content-per-container',
    containerMods: [...options.containerMods],
    ...(options.sevenZip ? { sevenZipVersion: options.sevenZip.version } : {}),
    sources: [...sources.values()],
    inspectedArchives,
    inspectedContainers,
    issues,
    existingArchiveMatchedInstalledFiles: files.filter(
      (v) => v.sourceMatches?.length,
    ).length,
    nestedMatchedInstalledFiles: files.filter((v) => v.bsaSourceMatches.length)
      .length,
    newlyMatchedInstalledFiles: files.filter(
      (v) => !v.sourceMatches?.length && v.bsaSourceMatches.length,
    ).length,
    combinedMatchedInstalledFiles: files.filter(
      (v) => v.sourceMatches?.length || v.bsaSourceMatches.length,
    ).length,
    combinedUnmatchedInstalledFiles: files.filter(
      (v) => !v.sourceMatches?.length && !v.bsaSourceMatches.length,
    ).length,
  };
  result.installable = false;
  result.publicationApproved = false;
  result.blockers = [
    ...new Set([
      ...(result.blockers || []),
      'Nested BSA matches prove exact content only; review source declarations, reconstruction, credits and permissions before creating a recipe.',
    ]),
  ];
  return result;
}
module.exports = { mapBsaSources };

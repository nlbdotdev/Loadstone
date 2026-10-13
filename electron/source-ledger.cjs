const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { relativeFile } = require('./manifest.cjs');
const { ordinaryFile, sameFile } = require('./native-package.cjs');
const { resolveSourceHints } = require('./source-hints.cjs');

function directory(root) {
  const stat = fs.lstatSync(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    fs.realpathSync(root).toLowerCase() !== path.resolve(root).toLowerCase()
  )
    throw new Error('Source ledger refuses redirected download folders.');
}
function nexusHint(file) {
  if (!fs.existsSync(file)) return null;
  ordinaryFile(file, 128000);
  const fields = new Map();
  let general = false;
  for (const raw of fs
    .readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      general = line.toLowerCase() === '[general]';
      continue;
    }
    if (!general) continue;
    const match = /^(gameName|modID|fileID)\s*=(.*)$/i.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (fields.has(key)) return null;
    fields.set(key, match[2].trim());
  }
  const game = fields.get('gamename')?.toLowerCase(),
    modId = Number(fields.get('modid')),
    fileId = Number(fields.get('fileid'));
  return ['falloutnv', 'fallout3', 'skyrimspecialedition', 'fallout4'].includes(
    game,
  ) && [modId, fileId].every((v) => Number.isSafeInteger(v) && v > 0)
    ? { game, modId, fileId }
    : null;
}
async function hashArchive(file, signal) {
  signal?.throwIfAborted();
  const before = ordinaryFile(file, 10_000_000_000_000),
    hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) {
    signal?.throwIfAborted();
    hash.update(chunk);
  }
  if (!sameFile(before, ordinaryFile(file, 10_000_000_000_000)))
    throw new Error('A source archive changed while being fingerprinted.');
  return { bytes: before.size, sha256: hash.digest('hex') };
}
function fileRecord(file) {
  if (
    !file ||
    !relativeFile(file.path) ||
    !Number.isSafeInteger(file.bytes) ||
    file.bytes < 0 ||
    !/^[a-f0-9]{64}$/.test(file.sha256)
  )
    throw new Error(
      'Source ledger requires complete SHA-256 file inventories.',
    );
  return { path: file.path, bytes: file.bytes, sha256: file.sha256 };
}
function nexusGame(value) {
  return (
    {
      newvegas: 'falloutnv',
      'new vegas': 'falloutnv',
      ttw: 'falloutnv',
      falloutnv: 'falloutnv',
      fallout3: 'fallout3',
      skyrimse: 'skyrimspecialedition',
      skyrimspecialedition: 'skyrimspecialedition',
      fallout4: 'fallout4',
    }[String(value).toLowerCase()] || null
  );
}
async function buildSourceLedger(inventory, downloadRoots, options = {}) {
  options.signal?.throwIfAborted();
  if (
    inventory?.kind !== 'loadstone-installed-inventory' ||
    inventory.schemaVersion !== 1 ||
    inventory.fileHashing !== 'sha256' ||
    !Array.isArray(inventory.mods) ||
    inventory.mods.length > 10000 ||
    !Array.isArray(inventory.overwrite) ||
    inventory.overwrite.length > 500000
  )
    throw new Error('Use a supported full hashed installed inventory.');
  if (!Array.isArray(downloadRoots) || downloadRoots.length > 20)
    throw new Error('Choose at most twenty download folders.');
  const archives = [],
    roots = new Set();
  for (const rootValue of downloadRoots) {
    options.signal?.throwIfAborted();
    const root = path.resolve(rootValue);
    if (roots.has(root.toLowerCase())) continue;
    roots.add(root.toLowerCase());
    directory(root);
    for (const name of fs.readdirSync(root)) {
      if (!/\.(zip|7z|rar)$/i.test(name)) continue;
      const file = path.join(root, name);
      ordinaryFile(file, 10_000_000_000_000);
      const metadata = `${file}.meta`;
      archives.push({ file, name, nexus: nexusHint(metadata) });
      if (archives.length > 100000)
        throw new Error('Too many cached archives.');
    }
  }
  const sourceHints = resolveSourceHints(options.hints, inventory, archives);
  const fingerprints = new Map(),
    mods = [];
  let count = 0,
    files = 0;
  for (const mod of inventory.mods) {
    options.signal?.throwIfAborted();
    if (
      !mod ||
      typeof mod.name !== 'string' ||
      !relativeFile(mod.name) ||
      /[\\/]/.test(mod.name) ||
      !Number.isSafeInteger(mod.position) ||
      mod.position < 0 ||
      typeof mod.enabled !== 'boolean' ||
      (mod.files !== undefined &&
        (!Array.isArray(mod.files) || mod.files.length > 1000000))
    )
      throw new Error('Invalid mod record in inventory.');
    const installed = (mod.files || []).map(fileRecord);
    files += installed.length;
    if (files > 1000000) throw new Error('Source ledger file limit exceeded.');
    const candidates = [];
    if ((mod.enabled || installed.length) && !mod.separator && !mod.unmanaged) {
      const hint =
        typeof mod.metadata?.installationFile === 'string'
          ? path.win32
              .basename(mod.metadata.installationFile.replaceAll('/', '\\'))
              .toLowerCase()
          : '';
      const modId = Number(mod.metadata?.modid);
      const game = nexusGame(
        mod.metadata?.gameName || inventory.source?.gameName,
      );
      for (const archive of archives) {
        const sameName = hint && archive.name.toLowerCase() === hint;
        const sameMod =
          modId > 0 &&
          archive.nexus?.modId === modId &&
          archive.nexus.game === game;
        const creatorHint =
          sourceHints.get(mod.name)?.has(archive.file.toLowerCase()) === true;
        if (!sameName && !sameMod && !creatorHint) continue;
        if (!fingerprints.has(archive.file))
          fingerprints.set(
            archive.file,
            await hashArchive(archive.file, options.signal),
          );
        candidates.push({
          archive: archive.file,
          ...fingerprints.get(archive.file),
          nexus: archive.nexus,
          matchedBy: sameName
            ? 'installation-filename'
            : sameMod
              ? 'mod-id-only'
              : 'creator-hint',
          ...(creatorHint ? { creatorHint: true } : {}),
          metadataConflict: Boolean(
            (sameName || creatorHint) &&
            archive.nexus &&
            ((modId > 0 && archive.nexus.modId !== modId) ||
              (game && archive.nexus.game !== game)),
          ),
        });
      }
    }
    mods.push({
      name: mod.name,
      position: mod.position,
      enabled: mod.enabled,
      unmanaged: mod.unmanaged,
      separator: mod.separator,
      present: mod.present,
      installedFiles: installed,
      archiveCandidates: candidates,
      reconstruction:
        (mod.enabled || mod.files !== undefined) && !mod.separator
          ? 'unresolved'
          : 'not-inventoried',
      permissions: 'unreviewed',
    });
    options.progress?.({
      phase: 'mods',
      completed: ++count,
      archivesHashed: fingerprints.size,
    });
  }
  const overwrite = inventory.overwrite.map(fileRecord);
  files += overwrite.length;
  if (files > 1000000) throw new Error('Source ledger file limit exceeded.');
  let exclusions;
  if (inventory.exclusions !== undefined) {
    const reasons = new Set([
      'saved-game-state',
      'credential-or-browser-state',
      'cache-log-or-backup-directory',
      'runtime-log-or-cache',
      'mod-directory-inventoried-separately',
      'profiles-inventoried-separately',
      'overwrite-inventoried-separately',
      'download-cache',
      'game-inventoried-separately',
    ]);
    if (
      !Array.isArray(inventory.exclusions) ||
      inventory.exclusions.length > 100000
    )
      throw new Error('Invalid inventory exclusions.');
    exclusions = inventory.exclusions.map((entry) => {
      if (
        !entry ||
        !relativeFile(entry.path) ||
        !reasons.has(entry.reason) ||
        !(
          ['instance', 'game', 'profile', 'overwrite'].includes(entry.scope) ||
          (typeof entry.scope === 'string' &&
            entry.scope.startsWith('mod:') &&
            relativeFile(entry.scope.slice(4)) &&
            !/[\\/]/.test(entry.scope.slice(4)))
        )
      )
        throw new Error('Invalid inventory exclusion record.');
      return { scope: entry.scope, path: entry.path, reason: entry.reason };
    });
  }
  let installation;
  if (inventory.installation !== undefined) {
    if (inventory.installation?.schemaVersion !== 1)
      throw new Error('Use a supported installation inventory.');
    installation = { schemaVersion: 1 };
    for (const key of ['instanceFiles', 'gameFiles', 'profileFiles']) {
      const entries = inventory.installation[key];
      if (!Array.isArray(entries) || entries.length > 1000000)
        throw new Error('Invalid installation file inventory.');
      files += entries.length;
      if (files > 1000000)
        throw new Error('Source ledger file limit exceeded.');
      installation[key] = entries.map(fileRecord);
    }
  }
  return {
    kind: 'loadstone-source-ledger',
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    profile: inventory.source?.profile,
    mods,
    overwrite,
    ...(installation ? { installation } : {}),
    ...(exclusions ? { exclusions } : {}),
    summary: {
      hintedMods: sourceHints.size,
      creatorHintedArchives: new Set(
        mods.flatMap((mod) =>
          mod.archiveCandidates
            .filter((v) => v.creatorHint)
            .map((v) => v.archive.toLowerCase()),
        ),
      ).size,
      enabledMods: mods.filter((v) => v.enabled && !v.separator).length,
      enabledModsWithArchiveCandidates: mods.filter(
        (v) => v.enabled && !v.separator && v.archiveCandidates.length,
      ).length,
      fingerprintedArchives: fingerprints.size,
      installedModFiles: mods.reduce(
        (sum, mod) => sum + mod.installedFiles.length,
        0,
      ),
      inventoriedDisabledModFiles: mods
        .filter((v) => !v.enabled)
        .reduce((sum, mod) => sum + mod.installedFiles.length, 0),
      ...(installation
        ? {
            installationFiles: Object.values(installation)
              .filter(Array.isArray)
              .reduce((sum, entries) => sum + entries.length, 0),
          }
        : {}),
      overwriteFiles: overwrite.length,
      resolvedFiles: 0,
    },
    blockers: [
      'Archive member bytes have not been compared with installed files.',
      'Root/game files and profile reconstruction still require mapping.',
      'Local edits and generated output need typed reconstruction or permitted payloads.',
      'Credits, permissions, save compatibility and gameplay acceptance require review.',
    ],
    installable: false,
    publicationApproved: false,
  };
}
module.exports = { buildSourceLedger };

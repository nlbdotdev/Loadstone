const path = require('node:path');
const games = Object.freeze({
  fnv: {
    name: 'Fallout: New Vegas',
    appId: '22380',
    executable: 'FalloutNV.exe',
  },
  skyrimse: {
    name: 'Skyrim Special Edition',
    appId: '489830',
    executable: 'SkyrimSE.exe',
  },
  fallout4: { name: 'Fallout 4', appId: '377160', executable: 'Fallout4.exe' },
});
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const text = (v, max = 500) =>
  typeof v === 'string' &&
  v.trim().length > 0 &&
  v.length <= max &&
  !/[\x00-\x1f]/.test(v);
function demand(ok, message) {
  if (!ok) throw new Error(`Invalid setup manifest: ${message}`);
}
function shape(v, keys) {
  demand(
    v && typeof v === 'object' && !Array.isArray(v),
    'expected an object.',
  );
  demand(
    Object.keys(v).every((k) => keys.includes(k)),
    'unknown fields are not supported.',
  );
}
function relativeFile(v) {
  return (
    text(v, 240) &&
    !path.win32.isAbsolute(v) &&
    !path.posix.isAbsolute(v) &&
    !/[:*?"<>|]/.test(v) &&
    v
      .split(/[\\/]/)
      .every(
        (p) =>
          p &&
          p !== '.' &&
          p !== '..' &&
          !/[. ]$/.test(p) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
      )
  );
}
function httpsUrl(v) {
  try {
    const u = new URL(v);
    return (
      text(v, 2048) && u.protocol === 'https:' && !u.username && !u.password
    );
  } catch {
    return false;
  }
}
function validateManifest(v) {
  shape(v, [
    'schemaVersion',
    'id',
    'name',
    'version',
    'description',
    'author',
    'website',
    'game',
    'storage',
    'archive',
    'launch',
    'credits',
  ]);
  demand(v.schemaVersion === 1, 'unsupported schema version.');
  demand(
    typeof v.id === 'string' && /^[a-z0-9][a-z0-9-]{2,63}$/.test(v.id),
    'invalid ID.',
  );
  for (const key of ['name', 'version', 'description', 'author'])
    demand(text(v[key]), `missing ${key}.`);
  demand(httpsUrl(v.website), 'website must use HTTPS.');
  shape(v.game, ['id', 'versions', 'executableHashes', 'requiredFiles']);
  demand(Object.hasOwn(games, v.game.id), 'unsupported game.');
  demand(
    Array.isArray(v.game.versions) &&
      v.game.versions.length > 0 &&
      v.game.versions.length <= 20 &&
      v.game.versions.every((x) => text(x, 64)),
    'declare supported game versions.',
  );
  demand(
    Array.isArray(v.game.executableHashes) &&
      v.game.executableHashes.length > 0 &&
      v.game.executableHashes.length <= 20 &&
      v.game.executableHashes.every(hash),
    'declare supported executable SHA-256 hashes.',
  );
  demand(
    Array.isArray(v.game.requiredFiles) && v.game.requiredFiles.length <= 100,
    'invalid required files.',
  );
  const files = new Set();
  for (const file of v.game.requiredFiles) {
    shape(file, ['path', 'sha256']);
    demand(
      relativeFile(file.path) &&
        hash(file.sha256) &&
        !files.has(file.path.toLowerCase()),
      'invalid or duplicate required file.',
    );
    files.add(file.path.toLowerCase());
  }
  shape(v.storage, ['downloadBytes', 'installBytes']);
  for (const key of ['downloadBytes', 'installBytes'])
    demand(
      Number.isSafeInteger(v.storage[key]) &&
        v.storage[key] > 0 &&
        v.storage[key] <= 10_000_000_000_000,
      'invalid storage requirement.',
    );
  shape(v.archive, ['file', 'sha256', 'source']);
  demand(
    relativeFile(v.archive.file) &&
      v.archive.file.endsWith('.wabbajack') &&
      hash(v.archive.sha256) &&
      httpsUrl(v.archive.source),
    'declare a local Wabbajack archive, hash, and original HTTPS source.',
  );
  shape(v.launch, ['manager', 'profile', 'executable']);
  demand(
    v.launch.manager === 'mo2' &&
      relativeFile(v.launch.profile) &&
      !/[\\/]/.test(v.launch.profile) &&
      text(v.launch.executable, 100),
    'declare an MO2 profile and executable title.',
  );
  demand(
    Array.isArray(v.credits) &&
      v.credits.length > 0 &&
      v.credits.length <= 1000,
    'credits and distribution rights are required.',
  );
  for (const credit of v.credits) {
    shape(credit, ['name', 'author', 'source', 'license']);
    demand(
      text(credit.name) &&
        text(credit.author) &&
        httpsUrl(credit.source) &&
        text(credit.license, 2000),
      'invalid credit or license statement.',
    );
  }
  return structuredClone(v);
}
module.exports = { games, validateManifest, relativeFile };

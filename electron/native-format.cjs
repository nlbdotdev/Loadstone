const { relativeFile } = require('./manifest.cjs');

const limits = Object.freeze({
  recipeBytes: 64_000_000,
  sources: 100000,
  outputs: 500000,
  payloadBytes: 256_000_000,
  packageBytes: 512_000_000,
});
const gameExecutables = {
  fnv: 'FalloutNV.exe',
  fallout3: 'Fallout3.exe',
  skyrimse: 'SkyrimSE.exe',
  fallout4: 'Fallout4.exe',
};
function demand(value, message) {
  if (!value) throw new Error(`Invalid .loadstone recipe: ${message}`);
}
function shape(value, keys) {
  demand(
    value && typeof value === 'object' && !Array.isArray(value),
    'expected an object.',
  );
  demand(
    Object.keys(value).every((key) => keys.includes(key)),
    'unknown fields are not supported.',
  );
}
const text = (v, max = 500) =>
  typeof v === 'string' &&
  v.trim().length > 0 &&
  v.length <= max &&
  !/[\x00-\x1f]/.test(v);
const id = (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v);
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const bytes = (v) =>
  Number.isSafeInteger(v) && v >= 0 && v <= 10_000_000_000_000;
const filePath = (v) =>
  relativeFile(v) && !v.includes('\\') && v === v.normalize('NFC');
function publicUrl(value) {
  try {
    const u = new URL(value);
    return (
      text(value, 2048) &&
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
    );
  } catch {
    return false;
  }
}
function array(value, max, min = 0) {
  demand(
    Array.isArray(value) && value.length >= min && value.length <= max,
    'invalid array length.',
  );
}
function fingerprint(value) {
  demand(
    hash(value.sha256) && bytes(value.bytes),
    'declare exact file SHA-256 and byte length.',
  );
}
function credit(value) {
  shape(value, ['name', 'url']);
  demand(
    text(value.name) && publicUrl(value.url),
    'declare attribution and a public HTTPS reference.',
  );
}
function uniquePaths(records) {
  const paths = new Set();
  for (const record of records) {
    demand(filePath(record.path), 'unsafe or noncanonical file path.');
    const key = record.path.toLowerCase();
    demand(!paths.has(key), 'duplicate Windows file path.');
    paths.add(key);
  }
  for (const key of paths) {
    const parts = key.split('/');
    while (parts.length > 1) {
      parts.pop();
      demand(!paths.has(parts.join('/')), 'file and directory paths overlap.');
    }
  }
  return paths;
}
function validateRecipe(value) {
  shape(value, [
    'format',
    'formatVersion',
    'id',
    'name',
    'version',
    'author',
    'description',
    'website',
    'game',
    'requirements',
    'launch',
    'sources',
    'outputs',
    'saveCompatibility',
  ]);
  demand(
    value.format === 'loadstone' && value.formatVersion === 1,
    'unsupported format version.',
  );
  demand(id(value.id), 'invalid recipe ID.');
  for (const key of ['name', 'version', 'author', 'description'])
    demand(text(value[key]), `missing ${key}.`);
  demand(
    publicUrl(value.website),
    'website must be a public HTTPS URL without credentials or query parameters.',
  );
  shape(value.game, ['id', 'variant']);
  demand(
    ['fnv', 'skyrimse', 'fallout4'].includes(value.game.id),
    'unsupported target game.',
  );
  demand(
    value.game.variant === 'base' ||
      (value.game.id === 'fnv' && value.game.variant === 'ttw'),
    'unsupported game variant.',
  );
  array(value.requirements, 2, 1);
  const required = new Map();
  for (const requirement of value.requirements) {
    shape(requirement, ['id', 'store', 'files']);
    demand(
      Object.hasOwn(gameExecutables, requirement.id) &&
        !required.has(requirement.id),
      'invalid or duplicate required game.',
    );
    demand(
      ['steam', 'gog'].includes(requirement.store),
      'unsupported game storefront.',
    );
    array(requirement.files, 10000, 1);
    const paths = uniquePaths(requirement.files);
    for (const file of requirement.files) {
      shape(file, ['path', 'sha256', 'bytes']);
      fingerprint(file);
    }
    demand(
      paths.has(gameExecutables[requirement.id].toLowerCase()),
      'required game must lock its executable.',
    );
    required.set(
      requirement.id,
      new Map(requirement.files.map((file) => [file.path.toLowerCase(), file])),
    );
  }
  const expectedGames =
    value.game.variant === 'ttw' ? ['fnv', 'fallout3'] : [value.game.id];
  demand(
    required.size === expectedGames.length &&
      expectedGames.every((v) => required.has(v)),
    'required games do not match the target variant.',
  );
  shape(value.launch, ['profile', 'executable', 'gameRoot']);
  demand(
    filePath(value.launch.profile) &&
      !value.launch.profile.includes('/') &&
      text(value.launch.executable, 100) &&
      filePath(value.launch.gameRoot),
    'declare an MO2 profile, executable title and isolated game root.',
  );
  array(value.sources, limits.sources, 1);
  const sources = new Map(),
    payloads = new Map();
  let downloadBytes = 0,
    payloadBytes = 0;
  for (const source of value.sources) {
    demand(
      source && id(source.id) && !sources.has(source.id),
      'invalid or duplicate source ID.',
    );
    const common = ['id', 'type', 'bytes', 'sha256'];
    if (source.type === 'game-file') {
      shape(source, [...common, 'game', 'path']);
      demand(filePath(source.path), 'unsafe owned-game input path.');
      const locked = required.get(source.game)?.get(source.path.toLowerCase());
      demand(
        locked &&
          locked.sha256 === source.sha256 &&
          locked.bytes === source.bytes,
        'owned-game inputs must match a required-game file.',
      );
    } else if (source.type === 'nexus-archive') {
      shape(source, [...common, 'game', 'modId', 'fileId', 'credit']);
      demand(
        ['falloutnv', 'fallout3', 'skyrimspecialedition', 'fallout4'].includes(
          source.game,
        ),
        'unsupported Nexus game domain.',
      );
      demand(
        [source.modId, source.fileId].every(
          (v) => Number.isSafeInteger(v) && v > 0,
        ),
        'Nexus sources require exact mod and file IDs.',
      );
      credit(source.credit);
      downloadBytes += source.bytes;
    } else if (source.type === 'https-archive') {
      shape(source, [...common, 'url', 'credit']);
      demand(
        publicUrl(source.url),
        'archive URL must be public HTTPS without credentials or query parameters.',
      );
      credit(source.credit);
      downloadBytes += source.bytes;
    } else if (source.type === 'payload') {
      shape(source, [...common, 'credit', 'permission']);
      credit(source.credit);
      shape(source.permission, ['license', 'evidence']);
      demand(
        text(source.permission.license, 200) &&
          publicUrl(source.permission.evidence),
        'bundled payloads require a license and public permission evidence.',
      );
      demand(
        !payloads.has(source.sha256),
        'declare each bundled payload hash once.',
      );
      payloads.set(source.sha256, source);
      payloadBytes += source.bytes;
    } else demand(false, 'unsupported source type.');
    fingerprint(source);
    sources.set(source.id, source);
  }
  demand(
    Number.isSafeInteger(downloadBytes) &&
      bytes(downloadBytes) &&
      payloadBytes <= limits.payloadBytes,
    'source storage exceeds supported bounds.',
  );
  array(value.outputs, limits.outputs, 1);
  const outputs = uniquePaths(value.outputs),
    used = new Set();
  let installBytes = 0;
  for (const output of value.outputs) {
    shape(output, ['path', 'sha256', 'bytes', 'action']);
    fingerprint(output);
    demand(
      !output.path
        .split('/')
        .some((v) => /^\.loadstone/i.test(v) || v.toLowerCase() === 'saves'),
      'output targets reserved state or saves.',
    );
    const action = output.action;
    demand(
      action && sources.has(action.source),
      'output references an unknown source.',
    );
    const source = sources.get(action.source);
    used.add(source.id);
    if (action.type === 'copy') {
      shape(action, ['type', 'source']);
      demand(
        ['game-file', 'payload'].includes(source.type) &&
          source.sha256 === output.sha256 &&
          source.bytes === output.bytes,
        'copy output must equal its file input.',
      );
    } else if (action.type === 'extract') {
      shape(action, ['type', 'source', 'member']);
      demand(
        ['nexus-archive', 'https-archive'].includes(source.type) &&
          filePath(action.member),
        'extract requires a locked archive and safe member path.',
      );
    } else
      demand(
        false,
        'unsupported reconstruction action; scripts are not allowed.',
      );
    installBytes += output.bytes;
  }
  demand(
    Number.isSafeInteger(installBytes) && bytes(installBytes),
    'output storage exceeds supported bounds.',
  );
  demand(used.size === sources.size, 'unused sources are not allowed.');
  for (const name of [
    'ModOrganizer.exe',
    'ModOrganizer.ini',
    `profiles/${value.launch.profile}/modlist.txt`,
    `profiles/${value.launch.profile}/plugins.txt`,
    `${value.launch.gameRoot}/${gameExecutables[value.game.id]}`,
  ]) {
    demand(
      outputs.has(name.toLowerCase()),
      'missing declared MO2 profile, manager or isolated game executable.',
    );
  }
  shape(value.saveCompatibility, ['status', 'notes']);
  demand(
    ['unknown', 'new-save-required', 'compatible'].includes(
      value.saveCompatibility.status,
    ) && text(value.saveCompatibility.notes, 2000),
    'declare save compatibility and guidance.',
  );
  return structuredClone(value);
}
function canonicalJson(value) {
  function sort(v) {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, sort(v[k])]),
      );
    return v;
  }
  return JSON.stringify(sort(value)) + '\n';
}
module.exports = { validateRecipe, canonicalJson, limits };

const fs = require('node:fs');
const path = require('node:path');
const { ordinary, fingerprint, tree } = require('./inventory-files.cjs');
const { contains } = require('./live-catalog.cjs');

function decode(value) {
  let result = value.replace(/^"(.*)"$/, '$1');
  if (result.startsWith('@ByteArray(') && result.endsWith(')'))
    result = result.slice(11, -1);
  return result.replaceAll('\\\\', '\\');
}
function ini(text) {
  const result = new Map();
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[;#]/.test(line)) continue;
    if (/^\[.*\]$/.test(line)) {
      section = line.slice(1, -1);
      continue;
    }
    const split = line.indexOf('=');
    if (split < 0) continue;
    const key = `${section}/${line.slice(0, split).trim()}`;
    if (result.has(key))
      throw new Error(
        'Duplicate INI field; resolve ambiguity before inventory.',
      );
    result.set(key, decode(line.slice(split + 1).trim()));
  }
  return result;
}
function safeName(value) {
  if (
    !value ||
    value.length > 240 ||
    /[\\/:\x00-\x1f<>"|?*]/.test(value) ||
    /[. ]$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) ||
    ['.', '..'].includes(value)
  )
    throw new Error('Unsafe profile or mod directory name.');
  return value;
}
function read(file, limit = 2_000_000) {
  if (ordinary(file).size > limit)
    throw new Error('Inventory text exceeds size limit.');
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
}
function lines(text) {
  return text
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter((v) => v && !v.startsWith('#'));
}
async function inspectMo2(root, options = {}) {
  options.signal?.throwIfAborted();
  root = path.resolve(root);
  ordinary(root, true);
  const progress = options.progress || (() => {});
  const guards = [],
    exclusions = [],
    budget = { files: 0 };
  const scan = (folder, scope, exclude) =>
    tree(
      folder,
      options.hashFiles === true,
      (value) => progress({ ...value, scope }),
      {
        guards,
        budget,
        signal: options.signal,
        exclude,
        excluded: (entry) => {
          if (exclusions.length >= 100000)
            throw new Error('Inventory exclusion limit exceeded.');
          exclusions.push({ scope, ...entry });
        },
      },
    );
  const configFile = path.join(root, 'ModOrganizer.ini');
  const configBefore = await fingerprint(configFile, options.signal);
  const config = ini(read(configFile));
  const base = path.resolve(root, config.get('Settings/base_directory') || '.');
  const location = (key, fallback) =>
    path.resolve(
      root,
      (config.get(`Settings/${key}`) || fallback).replaceAll(
        '%BASE_DIR%',
        base,
      ),
    );
  const profiles = location('profiles_directory', path.join(base, 'profiles'));
  const mods = location('mods_directory', path.join(base, 'mods'));
  const downloads = location(
    'download_directory',
    path.join(base, 'downloads'),
  );
  const overwritePath = location(
    'overwrite_directory',
    path.join(base, 'overwrite'),
  );
  ordinary(profiles, true);
  ordinary(mods, true);
  const profileName = safeName(
    options.profile || config.get('General/selected_profile'),
  );
  const profile = path.join(profiles, profileName);
  ordinary(profile, true);
  const snapshots = {};
  for (const name of [
    'modlist.txt',
    'plugins.txt',
    'loadorder.txt',
    'Fallout.ini',
    'FalloutPrefs.ini',
    'initweaks.ini',
  ]) {
    const file = path.join(profile, name);
    if (fs.existsSync(file))
      snapshots[name] = await fingerprint(file, options.signal);
  }
  if (!snapshots['modlist.txt'] || !snapshots['plugins.txt'])
    throw new Error('Missing profile modlist or plugin list.');
  const entries = [],
    names = new Set();
  for (const [index, line] of lines(
    read(path.join(profile, 'modlist.txt')),
  ).entries()) {
    if (!/^[+*-]/.test(line)) throw new Error('Unknown modlist record.');
    const name = safeName(line.slice(1)),
      identity = name.toLowerCase();
    if (names.has(identity))
      throw new Error('Duplicate mod directory in profile.');
    names.add(identity);
    const separator = name.endsWith('_separator');
    const item = {
      name,
      position: index,
      enabled: line[0] === '+',
      unmanaged: line[0] === '*',
      separator,
    };
    // MO2 records highest-priority entries first. Do not reverse this snapshot.
    const folder = path.join(mods, name);
    item.present = fs.existsSync(folder);
    if (item.present && !separator) {
      ordinary(folder, true);
      const metaFile = path.join(folder, 'meta.ini');
      if (fs.existsSync(metaFile)) {
        const meta = ini(read(metaFile));
        item.metadata = {};
        for (const field of [
          'gameName',
          'modid',
          'version',
          'installationFile',
          'url',
        ]) {
          const value = meta.get(`General/${field}`);
          if (value) item.metadata[field] = value;
        }
      }
      if (item.enabled || (options.installationFiles && !item.unmanaged))
        item.files = await scan(folder, `mod:${name}`);
    }
    entries.push(item);
    progress({ phase: 'mods', completed: entries.length });
  }
  const gameValue = config.get('General/gamePath');
  if (!gameValue)
    throw new Error('The selected instance has no game directory.');
  const game = path.resolve(root, gameValue);
  ordinary(game, true);
  const pluginLines = lines(read(path.join(profile, 'plugins.txt')));
  const starFormat = pluginLines.some((v) => v.startsWith('*'));
  const plugins = [];
  for (const entry of pluginLines) {
    const enabled = !starFormat || entry.startsWith('*');
    const name = safeName(entry.replace(/^\*/, ''));
    const candidates = [
      { layer: 'overwrite', file: path.join(overwritePath, name) },
      ...entries
        .filter((v) => v.enabled && v.present && !v.separator)
        .map((v) => ({ layer: v.name, file: path.join(mods, v.name, name) })),
      { layer: 'game', file: path.join(game, 'Data', name) },
    ].filter((v) => fs.existsSync(v.file));
    plugins.push({
      name,
      enabled,
      winner: candidates[0]?.layer || null,
      shadowed: candidates.slice(1).map((v) => v.layer),
      ...(candidates[0]
        ? await fingerprint(candidates[0].file, options.signal)
        : {}),
    });
  }
  const overwrite = fs.existsSync(overwritePath)
    ? await scan(overwritePath, 'overwrite')
    : [];
  let installation;
  if (options.installationFiles) {
    // Configured collections are captured separately or deliberately excluded.
    // Match absolute boundaries, not directory-name substrings.
    const separated = [
      [mods, 'mod-directory-inventoried-separately'],
      [profiles, 'profiles-inventoried-separately'],
      [overwritePath, 'overwrite-inventoried-separately'],
      [downloads, 'download-cache'],
      [game, 'game-inventoried-separately'],
    ];
    if (
      [mods, profiles, overwritePath, downloads, game].some((folder) =>
        contains(folder, root),
      )
    )
      throw new Error(
        'Installation inventory requires distinct instance and configured collection roots.',
      );
    const instanceFiles = await scan(root, 'instance', (relative) => {
      const full = path.join(root, relative);
      return separated.find(([folder]) => contains(folder, full))?.[1];
    });
    const gameFiles = await scan(game, 'game');
    const profileFiles = await scan(profile, 'profile');
    installation = { schemaVersion: 1, instanceFiles, gameFiles, profileFiles };
  }
  for (const [name, before] of Object.entries(snapshots)) {
    if (
      JSON.stringify(
        await fingerprint(path.join(profile, name), options.signal),
      ) !== JSON.stringify(before)
    )
      throw new Error(
        'Profile changed during inventory. Retry from a settled instance.',
      );
  }
  if (
    JSON.stringify(await fingerprint(configFile, options.signal)) !==
    JSON.stringify(configBefore)
  )
    throw new Error('Mod Organizer configuration changed during inventory.');
  progress({ phase: 'stability', trees: guards.length });
  for (const guard of guards) await guard();
  const missingMods = entries
    .filter((v) => v.enabled && !v.present && !v.separator)
    .map((v) => v.name);
  const missingPlugins = plugins
    .filter((v) => v.enabled && !v.winner)
    .map((v) => v.name);
  return {
    schemaVersion: 1,
    kind: 'loadstone-installed-inventory',
    capturedAt: new Date().toISOString(),
    source: {
      root,
      profile: profileName,
      gameFolder: game,
      modsFolder: mods,
      profileFolder: profile,
      profilesFolder: profiles,
      overwriteFolder: overwritePath,
      downloadsFolder: downloads,
      gameName: config.get('General/gameName'),
      configuration: configBefore,
    },
    fileHashing: options.hashFiles ? 'sha256' : 'metadata-only',
    profileFiles: snapshots,
    mods: entries,
    plugins,
    overwrite,
    ...(installation ? { installation } : {}),
    exclusions,
    summary: {
      enabledMods: entries.filter((v) => v.enabled && !v.separator).length,
      disabledMods: entries.filter(
        (v) => !v.enabled && !v.separator && !v.unmanaged,
      ).length,
      enabledPlugins: plugins.filter((v) => v.enabled).length,
      inventoriedModFiles: entries.reduce(
        (n, v) => n + (v.files?.length || 0),
        0,
      ),
      inventoriedDisabledModFiles: entries
        .filter((v) => !v.enabled)
        .reduce((sum, v) => sum + (v.files?.length || 0), 0),
      ...(installation
        ? {
            instanceFiles: installation.instanceFiles.length,
            gameFiles: installation.gameFiles.length,
            profileFiles: installation.profileFiles.length,
          }
        : {}),
      excludedPaths: exclusions.length,
      missingMods,
      missingPlugins,
    },
    installable: false,
    publicationApproved: false,
    limitations: [
      'Local inventory only: not a distributable install recipe.',
      'MO2 metadata is a source hint, not proof that installed files equal an upstream archive.',
      options.installationFiles
        ? 'Installation hashes preserve local bytes, not ownership, upstream equivalence, configuration portability or playability. Excluded state is listed explicitly.'
        : 'Base game and instance files, disabled mods and additional profile configuration are outside this scan; use --installation-files to inventory them.',
      'Archive contents, archive conflicts, plugin compatibility and gameplay require separate validation.',
      'No redistribution rights are inferred from local ownership or installation.',
    ],
  };
}
module.exports = { inspectMo2 };

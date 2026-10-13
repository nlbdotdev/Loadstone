const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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
function ordinary(file, directory = false) {
  const stat = fs.lstatSync(file);
  if (
    stat.isSymbolicLink() ||
    !(directory ? stat.isDirectory() : stat.isFile()) ||
    fs.realpathSync(file).toLowerCase() !== path.resolve(file).toLowerCase()
  )
    throw new Error('Redirected or non-ordinary inventory path.');
  return stat;
}
function read(file, limit = 2_000_000) {
  if (ordinary(file).size > limit)
    throw new Error('Inventory text exceeds size limit.');
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
}
async function fingerprint(file) {
  const before = ordinary(file);
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  const after = ordinary(file);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ino !== after.ino
  )
    throw new Error(
      'A file changed during inventory. Stop active modding or gameplay and retry.',
    );
  return { bytes: after.size, sha256: digest.digest('hex') };
}
async function tree(root, hashFiles, progress) {
  ordinary(root, true);
  const files = [],
    stack = [''];
  while (stack.length) {
    const relative = stack.pop();
    const folder = path.join(root, relative);
    ordinary(folder, true);
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const item = path.join(relative, entry.name),
        full = path.join(root, item);
      if (entry.isSymbolicLink())
        throw new Error('Inventory refuses redirected files and folders.');
      if (entry.isDirectory()) {
        stack.push(item);
        continue;
      }
      const stat = ordinary(full);
      files.push({
        path: item.replaceAll('\\', '/'),
        bytes: stat.size,
        mtimeMs: stat.mtimeMs,
      });
      if (files.length > 1_000_000)
        throw new Error('Inventory file limit exceeded.');
      if (files.length % 1000 === 0)
        progress({ phase: 'files', files: files.length });
    }
  }
  if (hashFiles) {
    let next = 0,
      completed = 0,
      failure;
    await Promise.all(
      Array.from({ length: Math.min(4, files.length) }, async () => {
        while (!failure && next < files.length) {
          const index = next++,
            relative = files[index].path;
          try {
            const hash = await fingerprint(path.join(root, relative));
            files[index] = { path: relative, ...hash };
            completed++;
            if (completed % 1000 === 0)
              progress({ phase: 'hashes', files: completed });
          } catch (error) {
            failure ||= error;
          }
        }
      }),
    );
    if (failure) throw failure;
  }
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
function lines(text) {
  return text
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter((v) => v && !v.startsWith('#'));
}
async function inspectMo2(root, options = {}) {
  root = path.resolve(root);
  ordinary(root, true);
  const progress = options.progress || (() => {});
  const configFile = path.join(root, 'ModOrganizer.ini');
  const configBefore = await fingerprint(configFile);
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
    if (fs.existsSync(file)) snapshots[name] = await fingerprint(file);
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
      if (item.enabled)
        item.files = await tree(folder, options.hashFiles === true, progress);
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
      ...(candidates[0] ? await fingerprint(candidates[0].file) : {}),
    });
  }
  const overwrite = fs.existsSync(overwritePath)
    ? await tree(overwritePath, options.hashFiles === true, progress)
    : [];
  for (const [name, before] of Object.entries(snapshots)) {
    if (
      JSON.stringify(await fingerprint(path.join(profile, name))) !==
      JSON.stringify(before)
    )
      throw new Error(
        'Profile changed during inventory. Retry from a settled instance.',
      );
  }
  if (
    JSON.stringify(await fingerprint(configFile)) !==
    JSON.stringify(configBefore)
  )
    throw new Error('Mod Organizer configuration changed during inventory.');
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
      gameName: config.get('General/gameName'),
      configuration: configBefore,
    },
    fileHashing: options.hashFiles ? 'sha256' : 'metadata-only',
    profileFiles: snapshots,
    mods: entries,
    plugins,
    overwrite,
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
      missingMods,
      missingPlugins,
    },
    installable: false,
    publicationApproved: false,
    limitations: [
      'Local inventory only: not a distributable install recipe.',
      'MO2 metadata is a source hint, not proof that installed files equal an upstream archive.',
      'Base game files, archive contents, archive conflicts, plugin compatibility and gameplay require separate validation.',
      'No redistribution rights are inferred from local ownership or installation.',
    ],
  };
}
module.exports = { inspectMo2 };

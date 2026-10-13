const path = require('node:path');
const crypto = require('node:crypto');
const { relativeFile } = require('./manifest.cjs');

const configBytes = 1_000_000;
const gameNames = {
  fnv: 'New Vegas',
  skyrimse: 'Skyrim Special Edition',
  fallout4: 'Fallout 4',
};
function demand(value, message) {
  if (!value) throw new Error(`Invalid native MO2 configuration: ${message}`);
}
function shape(value, keys) {
  demand(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
    'unsupported or missing fields.',
  );
}
const safePath = (v) =>
  relativeFile(v) &&
  v.isWellFormed() &&
  !v.includes('\\') &&
  v === v.normalize('NFC') &&
  !v
    .split('/')
    .some((s) => s.toLowerCase() === 'saves' || /^\.loadstone/i.test(s));

function validateMo2Config(output, recipe) {
  shape(output, ['path', 'action']);
  demand(
    output.path === 'ModOrganizer.ini',
    'only ModOrganizer.ini can be generated.',
  );
  shape(output.action, ['type', 'executables']);
  demand(output.action.type === 'mo2-config', 'unsupported generator.');
  demand(recipe.launch.profile.isWellFormed(), 'invalid profile text.');
  const entries = output.action.executables;
  demand(
    Array.isArray(entries) && entries.length > 0 && entries.length <= 64,
    'declare 1–64 executable entries.',
  );
  const files = new Set(recipe.outputs.map((v) => v.path.toLowerCase()));
  const orderedFiles = [...files].sort();
  function localReference(relative) {
    if (relative === '.' || files.has(relative)) return true;
    const prefix = relative + '/';
    let low = 0,
      high = orderedFiles.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (orderedFiles[middle] < prefix) low = middle + 1;
      else high = middle;
    }
    return orderedFiles[low]?.startsWith(prefix) === true;
  }
  const titles = new Set();
  for (const entry of entries) {
    shape(entry, [
      'title',
      'binary',
      'workingDirectory',
      ...(Object.hasOwn(entry || {}, 'arguments') ? ['arguments'] : []),
    ]);
    demand(
      typeof entry.title === 'string' &&
        entry.title.trim() === entry.title &&
        entry.title.length > 0 &&
        entry.title.length <= 100 &&
        !/[\x00-\x1f\x7f]/.test(entry.title) &&
        entry.title.isWellFormed(),
      'invalid executable title.',
    );
    const title = entry.title.toLowerCase();
    demand(!titles.has(title), 'duplicate executable title.');
    titles.add(title);
    demand(
      safePath(entry.binary) &&
        /\.exe$/i.test(entry.binary) &&
        files.has(entry.binary.toLowerCase()),
      'executables must name declared local .exe outputs.',
    );
    demand(
      (entry.workingDirectory === '.' || safePath(entry.workingDirectory)) &&
        entry.workingDirectory === path.posix.dirname(entry.binary),
      'working directory must be the executable’s local parent.',
    );
    if (entry.arguments !== undefined) {
      demand(
        Array.isArray(entry.arguments) &&
          entry.arguments.length > 0 &&
          entry.arguments.length <= 16,
        'declare 1–16 typed local-path arguments, or omit arguments.',
      );
      for (const argument of entry.arguments) {
        shape(argument, ['type', 'path']);
        demand(
          argument.type === 'path' &&
            (argument.path === '.' || safePath(argument.path)) &&
            localReference(argument.path.toLowerCase()),
          'arguments must reference a declared output or its local parent directory.',
        );
      }
    }
  }
  const launch = entries.find((v) => v.title === recipe.launch.executable);
  demand(
    launch &&
      launch.binary
        .toLowerCase()
        .startsWith(recipe.launch.gameRoot.toLowerCase() + '/'),
    'the selected launch entry must be inside the isolated game folder.',
  );
  const portable = recipe.outputs.find(
    (v) => v.path.toLowerCase() === 'portable.txt',
  );
  demand(
    portable?.bytes === 0 &&
      portable.sha256 ===
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'declare an empty portable.txt output.',
  );
  // These are writable MO2 directories, not file outputs. Empty directories
  // are created by the materializer; never let a recipe shadow one with a file.
  for (const folder of [
    'downloads',
    'mods',
    'profiles',
    'overwrite',
    'webcache',
  ])
    demand(!files.has(folder), 'a file shadows an MO2 state directory.');
}

// Qt 6 INI strings are UTF-8. Quote delimiters and escape literal @ variants.
// QByteArray is byte-oriented: escape every UTF-8 byte so non-ASCII game/profile
// paths cannot be interpreted using the machine's legacy code page.
function qtString(value) {
  return (
    '"' +
    (value.startsWith('@') ? '@' : '') +
    value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') +
    '"'
  );
}
function qtBytes(value) {
  return (
    '@ByteArray(' +
    [...Buffer.from(value, 'utf8')]
      .map((v) => '\\x' + v.toString(16).padStart(2, '0'))
      .join('') +
    ')'
  );
}
function renderMo2Config(output, recipe, destination) {
  validateMo2Config(output, recipe);
  demand(
    typeof destination === 'string' &&
      /^[A-Za-z]:[\\/]/.test(destination) &&
      destination.length <= 2048 &&
      !destination.includes('%BASE_DIR%') &&
      !/[\x00-\x1f\x7f<>"|?*]/.test(destination) &&
      !destination.slice(2).includes(':') &&
      destination.isWellFormed(),
    'choose a local Windows drive path of at most 2048 characters.',
  );
  const root = path.win32.resolve(destination).replaceAll('\\', '/');
  const local = (relative) => (relative === '.' ? root : `${root}/${relative}`);
  const lines = [
    '[General]',
    'gameName=' +
      qtString(
        recipe.game.variant === 'ttw' ? 'TTW' : gameNames[recipe.game.id],
      ),
    'gamePath=' + qtBytes(local(recipe.launch.gameRoot)),
    'selected_profile=' + qtBytes(recipe.launch.profile),
    'first_start=false',
    '',
    '[Settings]',
    'base_directory=' + qtString(root),
    ...['download', 'mod', 'profiles', 'overwrite', 'cache'].map((key) => {
      const folder =
        { download: 'downloads', mod: 'mods', cache: 'webcache' }[key] || key;
      return `${key}_directory=${qtString(local(folder))}`;
    }),
    'profile_local_inis=true',
    'profile_local_saves=true',
    '',
    '[customExecutables]',
    `size=${output.action.executables.length}`,
  ];
  for (const [i, entry] of output.action.executables.entries()) {
    const prefix = `${i + 1}\\`;
    lines.push(
      prefix + 'title=' + qtString(entry.title),
      prefix + 'binary=' + qtString(local(entry.binary)),
      prefix + 'workingDirectory=' + qtString(local(entry.workingDirectory)),
      prefix +
        'arguments=' +
        (entry.arguments
          ? qtString(
              entry.arguments.map((v) => '"' + local(v.path) + '"').join(' '),
            )
          : ''),
    );
  }
  const data = Buffer.from(lines.join('\n') + '\n', 'utf8');
  demand(data.length <= configBytes, 'generated file exceeds its size limit.');
  return {
    data,
    bytes: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
  };
}
module.exports = { configBytes, validateMo2Config, renderMo2Config };

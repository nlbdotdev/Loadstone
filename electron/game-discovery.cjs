const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { games } = require('./manifest.cjs');
// Steam's text KeyValues files: reject truncated/ambiguous documents rather than
// guessing an install directory from unrelated quoted strings.
function parseVdf(input) {
  if (input.length > 2_000_000) throw new Error('Steam metadata is too large.');
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }
    if (input.slice(i, i + 2) === '//') {
      while (i < input.length && input[i] !== '\n') i++;
      continue;
    }
    if ('{}'.includes(input[i])) {
      tokens.push(input[i++]);
      continue;
    }
    if (input[i++] !== '"') throw new Error('Unsupported Steam metadata.');
    let value = '',
      closed = false;
    while (i < input.length) {
      const c = input[i++];
      if (c === '"') {
        closed = true;
        break;
      }
      if (c === '\\' && ['\\', '"'].includes(input[i])) value += input[i++];
      else value += c;
    }
    if (!closed) throw new Error('Truncated Steam metadata.');
    tokens.push({ value });
  }
  let index = 0;
  function object(depth = 0, nested = false) {
    if (depth > 20) throw new Error('Steam metadata is too deeply nested.');
    const result = Object.create(null);
    while (index < tokens.length && tokens[index] !== '}') {
      const key = tokens[index++];
      if (!key?.value || Object.hasOwn(result, key.value))
        throw new Error('Invalid Steam metadata key.');
      const value = tokens[index++];
      if (value === '{') result[key.value] = object(depth + 1, true);
      else if (value && typeof value === 'object')
        result[key.value] = value.value;
      else throw new Error('Invalid Steam metadata value.');
    }
    if (nested && tokens[index++] !== '}')
      throw new Error('Truncated Steam metadata object.');
    return result;
  }
  const result = object();
  if (index !== tokens.length)
    throw new Error('Unexpected Steam metadata terminator.');
  return result;
}
async function steamRoots() {
  const roots = new Set();
  for (const base of [
    process.env['ProgramFiles(x86)'],
    process.env.ProgramFiles,
  ])
    if (base) roots.add(path.join(base, 'Steam'));
  if (process.platform === 'win32') {
    try {
      const { stdout } = await promisify(execFile)(
        'reg.exe',
        ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
        { windowsHide: true, timeout: 5000 },
      );
      const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i);
      if (match) roots.add(path.normalize(match[1].trim()));
    } catch {
      /* The app can still use manual game selection. */
    }
  }
  return [...roots];
}
function discoverGames(roots) {
  const libraries = new Set(),
    warnings = [];
  for (const root of roots) {
    libraries.add(root);
    const file = path.join(root, 'steamapps', 'libraryfolders.vdf');
    if (!fs.existsSync(file)) continue;
    try {
      const folders = parseVdf(fs.readFileSync(file, 'utf8')).libraryfolders;
      for (const entry of Object.values(folders || {})) {
        const folder = typeof entry === 'string' ? entry : entry.path;
        if (typeof folder === 'string' && path.isAbsolute(folder))
          libraries.add(path.normalize(folder));
      }
    } catch {
      warnings.push(
        `Could not read Steam libraries in ${root}. Select the game folder manually.`,
      );
    }
  }
  const found = [],
    seen = new Set();
  for (const root of libraries)
    for (const [id, game] of Object.entries(games)) {
      const file = path.join(
        root,
        'steamapps',
        `appmanifest_${game.appId}.acf`,
      );
      if (!fs.existsSync(file)) continue;
      try {
        const state = parseVdf(fs.readFileSync(file, 'utf8')).AppState;
        if (
          state.appid !== game.appId ||
          typeof state.installdir !== 'string' ||
          /[\\/:]/.test(state.installdir) ||
          ['.', '..'].includes(state.installdir)
        )
          throw new Error('Invalid install folder.');
        const folder = fs.realpathSync(
          path.join(root, 'steamapps', 'common', state.installdir),
        );
        if (
          !fs.statSync(path.join(folder, game.executable)).isFile() ||
          seen.has(folder.toLowerCase())
        )
          continue;
        seen.add(folder.toLowerCase());
        found.push({
          id,
          name: game.name,
          folder,
          source: 'steam',
          buildId: state.buildid || null,
        });
      } catch {
        warnings.push(
          `Could not confirm ${game.name} in ${root}. Select the game folder manually.`,
        );
      }
    }
  return { games: found, warnings };
}
module.exports = { parseVdf, steamRoots, discoverGames };

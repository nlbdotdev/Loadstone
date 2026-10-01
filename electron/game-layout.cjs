const fs = require('node:fs');
const path = require('node:path');
const { canonical, contains } = require('./live-catalog.cjs');
const { games } = require('./manifest.cjs');
function verifyGameLayout(job, output, ini, binary) {
  const relative = job.manifest.launch.gameRoot;
  if (!relative) return;
  const root = path.resolve(output, relative);
  try {
    if (
      !contains(output, root) ||
      root === output ||
      canonical(root).toLowerCase() !== root.toLowerCase() ||
      !fs.statSync(root).isDirectory()
    )
      throw new Error();
    const executable = path.join(root, games[job.manifest.game.id].executable);
    if (
      canonical(executable).toLowerCase() !== executable.toLowerCase() ||
      !fs.statSync(executable).isFile()
    )
      throw new Error();
  } catch {
    throw new Error(
      'The declared isolated game folder or game executable is missing or redirected.',
    );
  }
  let section = '',
    paths = [];
  for (const line of ini.split(/\r?\n/)) {
    const heading = line.match(/^\[([^\]]+)\]/);
    if (heading) {
      section = heading[1];
      continue;
    }
    const setting = line.match(/^gamePath=(.*)$/);
    if (section === 'General' && setting) paths.push(setting[1]);
  }
  if (paths.length !== 1)
    throw new Error(
      'MO2 must declare exactly one gamePath for this isolated setup.',
    );
  let configured = paths[0].replace(/^"(.*)"$/, '$1');
  const bytes = configured.match(/^@ByteArray\((.*)\)$/);
  if (bytes) configured = bytes[1];
  configured = configured.replaceAll('\\\\', '\\');
  if (
    canonical(path.resolve(output, configured)).toLowerCase() !==
    root.toLowerCase()
  )
    throw new Error(
      'MO2 points at a different game folder. Restore this setup’s isolated game layout before launching.',
    );
  if (!contains(root, binary))
    throw new Error(
      'The selected launch entry points outside the isolated game folder.',
    );
}
module.exports = { verifyGameLayout };

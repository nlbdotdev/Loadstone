const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { setImmediate } = require('node:timers/promises');

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
const identity = (stat) => [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino];
async function fingerprint(file, signal, { mtime = false } = {}) {
  const before = ordinary(file),
    digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) {
    signal?.throwIfAborted();
    digest.update(chunk);
  }
  const after = ordinary(file);
  if (JSON.stringify(identity(before)) !== JSON.stringify(identity(after)))
    throw new Error(
      'A file changed during inventory. Stop active modding or gameplay and retry.',
    );
  return {
    bytes: after.size,
    sha256: digest.digest('hex'),
    ...(mtime ? { mtimeMs: Math.round(after.mtimeMs) } : {}),
  };
}

// Do not open personal state just to decide whether to inventory it. Skipped
// paths are reported explicitly; exclusions are not proof of a complete recipe.
function excludedState(relative, directory) {
  const name = path.basename(relative).toLowerCase();
  if (
    /^(saves?|savegames?)(?:$|[ _.-])/.test(name) ||
    /\.(fos|fose|ess|skse|nvse)(?:$|\.)/.test(name)
  )
    return 'saved-game-state';
  if (
    /^\.env(?:\.|$)/.test(name) ||
    (!directory &&
      (/(?:^|[._-])(?:api[_-]?keys?|credentials?|authorization|auth[_-]?tokens?|access[_-]?tokens?|refresh[_-]?tokens?|tokens?|secrets?)\.(?:json|ini|txt|db|sqlite3?|dat|bin)$/.test(
        name,
      ) ||
        /^(?:api[_-]?keys?|credentials?|authorization|auth[_-]?tokens?|access[_-]?tokens?|refresh[_-]?tokens?|tokens?|secrets?)$/.test(
          name,
        ) ||
        /^_?nexus[_-]?headers(?:\.(?:txt|json|ini))?$/.test(name) ||
        /^cookies(?:$|[-.](?:sqlite(?:-wal|-shm)?|journal|db(?:-wal|-shm)?|txt|json)$)|^login data(?:-journal|-wal|-shm)?$|^loginusers\.vdf$|^local state$|^ssfn\d+$/.test(
          name,
        )))
  )
    return 'credential-or-browser-state';
  if (
    directory &&
    /^(?:webcache|\.git|node_modules|logs?|crash[ _-]?logs?|crashdumps|backups?|__temp__|_codex_stage|staging)$/.test(
      name,
    )
  )
    return 'cache-log-or-backup-directory';
  if (
    !directory &&
    (/\.(?:log|dmp)$/.test(name) ||
      ['consolehistory.txt', 'script_data_cache.bin'].includes(name))
  )
    return 'runtime-log-or-cache';
  return null;
}

async function tree(root, hashFiles, progress, options = {}) {
  const rootIdentity = ordinary(root, true).ino;
  async function collect(recordExclusions) {
    const files = [],
      snapshot = [],
      stack = [''];
    let directories = 0;
    while (stack.length) {
      options.signal?.throwIfAborted();
      const relative = stack.pop(),
        folder = path.join(root, relative);
      const folderStat = ordinary(folder, true);
      snapshot.push([relative, 'directory', folderStat.ino]);
      if (++directories > 100000)
        throw new Error('Inventory directory limit exceeded.');
      if (directories % 1000 === 0) await setImmediate();
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const item = path.join(relative, entry.name),
          full = path.join(root, item);
        const reason =
          options.exclude?.(item, entry.isDirectory()) ||
          excludedState(item, entry.isDirectory());
        if (reason) {
          if (recordExclusions)
            options.excluded?.({ path: item.replaceAll('\\', '/'), reason });
          continue;
        }
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
        snapshot.push([item, 'file', ...identity(stat)]);
        if (
          files.length > 1_000_000 ||
          (recordExclusions &&
            options.budget &&
            ++options.budget.files > 1_000_000)
        )
          throw new Error('Inventory file limit exceeded.');
        if (files.length % 1000 === 0) {
          if (recordExclusions)
            progress({ phase: 'files', files: files.length });
          await setImmediate();
        }
      }
    }
    files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
    snapshot.sort((a, b) => a[0].localeCompare(b[0], 'en'));
    return { files, snapshot };
  }
  const { files, snapshot } = await collect(true);
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
            files[index] = {
              path: relative,
              ...(await fingerprint(path.join(root, relative), options.signal)),
            };
            if (++completed % 1000 === 0)
              progress({ phase: 'hashes', files: completed });
          } catch (error) {
            failure ||= error;
          }
        }
      }),
    );
    if (failure) throw failure;
  }
  options.guards?.push(async () => {
    if (
      ordinary(root, true).ino !== rootIdentity ||
      JSON.stringify((await collect(false)).snapshot) !==
        JSON.stringify(snapshot)
    )
      throw new Error(
        'Inventory tree changed during inspection. Retry from a settled installation.',
      );
  });
  return files;
}
module.exports = { ordinary, fingerprint, tree };

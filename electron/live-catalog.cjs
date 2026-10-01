const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateManifest, games } = require('./manifest.cjs');
const { inspectList } = require('./wabbajack-list.cjs');
async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function canonical(file) {
  const missing = [];
  let ancestor = path.resolve(file);
  while (!fs.existsSync(ancestor)) {
    missing.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('The drive is unavailable.');
    ancestor = parent;
  }
  return path.join(fs.realpathSync(ancestor), ...missing);
}
function contains(parent, child) {
  const rel = path.relative(parent, child);
  return (
    rel === '' ||
    (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))
  );
}
class LiveCatalog {
  constructor(root, applicationRoots = []) {
    this.applicationRoots = applicationRoots;
    this.file = path.join(root, 'live-catalog.json');
    this.entries = [];
    if (fs.existsSync(this.file)) {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (
        saved.schemaVersion !== 1 ||
        !Array.isArray(saved.entries) ||
        saved.entries.length > 100
      )
        throw new Error(
          'Unsupported live catalog. Preserve the file and update Loadstone.',
        );
      const ids = new Set();
      this.entries = saved.entries.map((entry) => {
        const manifest = validateManifest(entry.manifest);
        if (
          typeof entry.folder !== 'string' ||
          !path.isAbsolute(entry.folder) ||
          ids.has(manifest.id)
        )
          throw new Error('Invalid saved live catalog.');
        ids.add(manifest.id);
        return { manifest, folder: entry.folder };
      });
    }
  }
  list() {
    return this.entries.map(({ manifest }) => manifest);
  }
  inspectImport(file) {
    if (typeof file !== 'string' || fs.statSync(file).size > 2_000_000)
      throw new Error('Manifest exceeds the 2 MB limit.');
    const manifest = validateManifest(
      JSON.parse(fs.readFileSync(file, 'utf8')),
    );
    const previous = this.entries.find((x) => x.manifest.id === manifest.id);
    if (previous) {
      if (previous.manifest.version === manifest.version)
        throw new Error('This setup version is already imported.');
      if (previous.manifest.game.id !== manifest.game.id)
        throw new Error('An update cannot change the setup game.');
      if (!manifest.update?.fromVersions.includes(previous.manifest.version))
        throw new Error(
          'The creator must declare this update from the currently imported version.',
        );
    } else if (this.entries.length >= 100)
      throw new Error('The catalog is full.');
    return {
      manifest,
      folder: fs.realpathSync(path.dirname(file)),
      previous: previous?.manifest || null,
    };
  }
  import(file, approved = null) {
    const candidate = this.inspectImport(file);
    if (
      candidate.previous &&
      JSON.stringify(candidate) !== JSON.stringify(approved)
    )
      throw new Error('Review and confirm this setup version replacement.');
    const { manifest, folder } = candidate;
    const entries = [
      ...this.entries.filter((x) => x.manifest.id !== manifest.id),
      { manifest, folder },
    ];
    fs.writeFileSync(
      this.file + '.tmp',
      JSON.stringify({ schemaVersion: 1, entries }, null, 2),
      { flush: true },
    );
    fs.renameSync(this.file + '.tmp', this.file);
    this.entries = entries;
    return this.list();
  }
  async preflight(
    { id, gameFolder, destination },
    engineVersion = '4.2.3.0',
    ownedId = null,
    override = null,
  ) {
    const entry = override || this.entries.find((x) => x.manifest.id === id);
    if (!entry) throw new Error('Unknown imported setup.');
    if (
      ![gameFolder, destination].every(
        (x) =>
          typeof x === 'string' &&
          x.length <= 1024 &&
          !x.includes('\0') &&
          path.isAbsolute(x),
      )
    )
      throw new Error('Select absolute game and installation folders.');
    let list = null;
    const { manifest } = entry,
      checks = [];
    async function check(name, run) {
      try {
        checks.push({ name, status: 'pass', detail: await run() });
      } catch (error) {
        const detail =
          error.code === 'ENOENT'
            ? `Required file or folder was not found${error.path ? ': ' + path.basename(error.path) : '.'}`
            : ['EACCES', 'EPERM'].includes(error.code)
              ? 'Loadstone cannot access this location. Choose an accessible folder or restore its permissions.'
              : error.code === 'ENOTDIR'
                ? 'Select a folder rather than a file.'
                : error.message;
        checks.push({ name, status: 'fail', detail });
      }
    }
    await check('Game version', async () => {
      const root = canonical(gameFolder);
      const executable = canonical(
        path.join(gameFolder, games[manifest.game.id].executable),
      );
      if (!contains(root, executable))
        throw new Error(
          'The game executable points outside the selected game folder.',
        );
      const digest = await sha256(executable);
      if (!manifest.game.executableHashes.includes(digest))
        throw new Error(
          `Executable does not match supported versions: ${manifest.game.versions.join(', ')}.`,
        );
      return 'Executable matches a supported SHA-256 hash.';
    });
    await check('Required game files', async () => {
      const root = canonical(gameFolder);
      for (const file of manifest.game.requiredFiles) {
        const target = canonical(path.join(gameFolder, file.path));
        if (!contains(root, target) || (await sha256(target)) !== file.sha256)
          throw new Error(`Missing or incompatible game file: ${file.path}`);
      }
      return `${manifest.game.requiredFiles.length} required files verified.`;
    });
    await check('List archive', async () => {
      const archive = canonical(path.join(entry.folder, manifest.archive.file));
      if (
        !contains(canonical(entry.folder), archive) ||
        (await sha256(archive)) !== manifest.archive.sha256
      )
        throw new Error(
          'The local list archive is missing or its SHA-256 hash differs.',
        );
      list = await inspectList(archive, manifest, engineVersion);
      if (list.unsupportedSources.length)
        throw new Error(
          `This list needs download sources that Loadstone does not support yet: ${list.unsupportedSources.join(', ')}.`,
        );
      return `${list.name}: archive hash, game, MO2 profile, ${list.archives} source archives and ${list.files} output paths verified.`;
    });
    await check('Installation folder', async () => {
      const target = canonical(destination),
        game = canonical(gameFolder);
      if (contains(target, game) || contains(game, target))
        throw new Error(
          'Choose a separate folder outside the game installation.',
        );
      const protectedRoots = [
        ...this.applicationRoots,
        process.env.WINDIR,
        process.env.ProgramFiles,
        process.env['ProgramFiles(x86)'],
        path.dirname(this.file),
      ].filter(Boolean);
      if (
        target === path.parse(target).root ||
        protectedRoots.some(
          (p) =>
            contains(canonical(p), target) || contains(target, canonical(p)),
        )
      )
        throw new Error(
          'Choose a dedicated setup folder outside system and Loadstone folders.',
        );
      if (
        fs.existsSync(target) &&
        (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length)
      ) {
        let owner = null;
        if (ownedId) {
          try {
            owner = JSON.parse(
              fs.readFileSync(
                path.join(target, '.loadstone-owner.json'),
                'utf8',
              ),
            );
          } catch {}
        }
        if (!owner || owner.jobId !== ownedId || owner.setupId !== id)
          throw new Error('Use an empty folder for this installation.');
      }
      let ancestor = target;
      while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
      fs.accessSync(ancestor, fs.constants.W_OK);
      const stats = fs.statfsSync(ancestor, { bigint: true });
      const required = BigInt(
        manifest.storage.downloadBytes + manifest.storage.installBytes,
      );
      if (stats.bavail * stats.bsize < required)
        throw new Error(
          'Insufficient free space for the archives and installed setup.',
        );
      return 'Folder is separate, empty, writable, and has sufficient free space.';
    });
    checks.push({
      name: 'Installer connection',
      status: 'fail',
      detail:
        'The Wabbajack installation adapter and Nexus authentication are not connected yet.',
    });
    return {
      id,
      checkedAt: new Date().toISOString(),
      ready: checks.every((x) => x.status === 'pass'),
      checks,
      list,
    };
  }
}
module.exports = { LiveCatalog, sha256, canonical, contains };

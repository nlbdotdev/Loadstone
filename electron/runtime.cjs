const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const yauzl = require('yauzl');
const { sha256, contains } = require('./live-catalog.cjs');
const { relativeFile } = require('./manifest.cjs');
const PIN = Object.freeze({
  version: '4.2.3.0',
  url: 'https://github.com/wabbajack-tools/wabbajack/releases/download/4.2.3.0/4.2.3.0.zip',
  size: 145800825,
  sha256: '91392832f4466420a02687fa6e92192897e8e4b5b1b3dc97fbe36f7a4e490ba5',
  executableHash:
    'd6be220fa0b1e86d67e150eebb44aa07e8617efcd42068a299e4786c3799f7b9',
  inventoryHash:
    '95c8124ee22c3819483ad4ebe4f00555704da3d6919f1c071aecbe2b3bf658a8',
});
async function extractZip(archive, directory, signal, progress = () => {}) {
  const zip = await yauzl.openPromise(archive, {
    lazyEntries: true,
    validateEntrySizes: true,
  });
  const files = [],
    seen = new Set();
  let total = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      signal?.throwIfAborted();
      const name = entry.fileName.replace(/\/$/, '');
      if (
        !relativeFile(name) ||
        seen.has(name.toLowerCase()) ||
        ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000
      )
        throw new Error(
          'The runtime archive contains an unsafe or duplicate path.',
        );
      seen.add(name.toLowerCase());
      total += entry.uncompressedSize;
      if (seen.size > 5000 || total > 1_000_000_000)
        throw new Error('The runtime archive exceeds extraction limits.');
      const target = path.join(directory, name);
      if (!contains(directory, target))
        throw new Error('The runtime archive escapes its destination.');
      if (entry.fileName.endsWith('/')) {
        fs.mkdirSync(target, { recursive: true });
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const source = await zip.openReadStreamPromise(entry);
      await pipeline(source, fs.createWriteStream(target, { flags: 'wx' }), {
        signal,
      });
      files.push({ path: name, sha256: await sha256(target) });
      progress(files.length);
    }
  } finally {
    zip.close();
  }
  return files;
}
async function inspectRuntime(directory, cwd) {
  const executable = path.join(directory, 'wabbajack-cli.exe');
  if ((await sha256(executable)) !== PIN.executableHash)
    throw new Error('The Wabbajack executable failed its integrity check.');
  const run = (args) =>
    promisify(execFile)(executable, args, {
      cwd,
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 512000,
    });
  const { stdout: version } = await run(['--version']);
  if (!version.trim().startsWith(PIN.version + '+'))
    throw new Error('Unsupported Wabbajack runtime version.');
  const { stdout: help } = await run(['install', '--help']);
  for (const flag of ['--wabbajack', '--output', '--downloads'])
    if (!help.includes(flag))
      throw new Error(
        'Wabbajack does not expose the required installation interface.',
      );
  return { version: version.trim(), executable };
}
function parseGameLocations(output) {
  const names = {
    'Fallout New Vegas': 'fnv',
    'Skyrim Special Edition': 'skyrimse',
    'Fallout 4': 'fallout4',
  };
  const found = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(
      /\[INFO\] \[X\] (Fallout New Vegas|Skyrim Special Edition|Fallout 4) (.*?) -> Path: (.+)$/,
    );
    if (match && path.isAbsolute(match[3]) && !/[\x00-\x1f]/.test(match[3])) {
      const id = names[match[1]];
      if (found.some((game) => game.id === id))
        throw new Error('The installer reported ambiguous game locations.');
      found.push({ id, version: match[2], folder: match[3] });
    }
  }
  return found;
}
class Runtime {
  constructor(root) {
    this.root = path.join(root, 'engines');
    fs.mkdirSync(this.root, { recursive: true });
    this.root = fs.realpathSync(this.root);
    this.directory = path.join(this.root, `wabbajack-${PIN.version}`);
    this.work = path.join(root, 'engine-work');
    fs.mkdirSync(this.work, { recursive: true });
    this.current = {
      status: 'missing',
      version: PIN.version,
      phase: 'Not installed',
      downloadedBytes: 0,
      totalBytes: PIN.size,
      error: null,
    };
    this.controller = null;
  }
  status() {
    return structuredClone(this.current);
  }
  async gameLocations() {
    if (this.current.status !== 'ready' || this.controller || this.verifying)
      throw new Error(
        'Verify the installation engine before checking its game selection.',
      );
    try {
      const { stdout } = await promisify(execFile)(
        path.join(this.directory, 'wabbajack-cli.exe'),
        ['list-games'],
        {
          cwd: this.work,
          windowsHide: true,
          timeout: 30000,
          maxBuffer: 2_000_000,
        },
      );
      return parseGameLocations(stdout);
    } catch {
      throw new Error(
        'The installation engine could not confirm its game locations. Check the game installation and try again.',
      );
    }
  }
  async verify() {
    if (this.controller || this.verifying) return this.status();
    if (!fs.existsSync(this.directory)) {
      this.current.status = 'missing';
      this.current.phase = 'Not installed';
      this.current.error = null;
      return this.status();
    }
    this.verifying = true;
    this.current.status = 'checking';
    this.current.phase = 'Verifying runtime';
    try {
      const inventoryFile = path.join(
        this.directory,
        '.loadstone-inventory.json',
      );
      if (fs.statSync(inventoryFile).size > 2_000_000)
        throw new Error('Runtime inventory is invalid.');
      const inventory = JSON.parse(fs.readFileSync(inventoryFile, 'utf8'));
      if (
        inventory.archiveHash !== PIN.sha256 ||
        !Array.isArray(inventory.files) ||
        inventory.files.length < 10 ||
        inventory.files.length > 5000
      )
        throw new Error('Runtime inventory is invalid.');
      if (
        crypto
          .createHash('sha256')
          .update(JSON.stringify(inventory.files))
          .digest('hex') !== PIN.inventoryHash
      )
        throw new Error('Runtime inventory does not match the pinned release.');
      const expected = new Set([
        ...inventory.files.map((file) => file.path.toLowerCase()),
        '.loadstone-inventory.json',
      ]);
      const inspectTree = (folder, prefix = '') => {
        if (fs.lstatSync(folder).isSymbolicLink())
          throw new Error('Runtime folders must not be symbolic links.');
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
          const relative = prefix + entry.name;
          if (entry.isSymbolicLink())
            throw new Error('Runtime files must not be symbolic links.');
          if (entry.isDirectory())
            inspectTree(path.join(folder, entry.name), relative + '/');
          else if (!expected.has(relative.toLowerCase()))
            throw new Error(
              'Unexpected runtime files were found. Repair the engine before installing a setup.',
            );
        }
      };
      inspectTree(this.directory);
      for (const file of inventory.files) {
        if (
          !relativeFile(file.path) ||
          !/^[a-f0-9]{64}$/.test(file.sha256) ||
          (await sha256(path.join(this.directory, file.path))) !== file.sha256
        )
          throw new Error(
            'Runtime files are missing or changed. Install the engine again to repair them.',
          );
      }
      await inspectRuntime(this.directory, this.work);
      this.current.status = 'ready';
      this.current.phase = 'Runtime verified';
      this.current.error = null;
    } catch (error) {
      this.current.status = 'error';
      this.current.phase = 'Repair required';
      this.current.error = error.message;
    } finally {
      this.verifying = false;
    }
    return this.status();
  }
  cancel() {
    this.controller?.abort();
    return this.status();
  }
  async install(archiveForVerification) {
    if (this.inUse)
      throw new Error(
        'Wait for the active setup installation to finish before changing the engine.',
      );
    if (this.verifying)
      throw new Error('Wait for engine verification to finish.');
    if (this.controller)
      throw new Error('The engine is already being installed.');
    if (process.platform !== 'win32')
      throw new Error('This Wabbajack runtime requires Windows.');
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const stage = path.join(this.root, `.stage-${crypto.randomUUID()}`);
    const archive = path.join(stage, 'runtime.zip'),
      unpacked = path.join(stage, 'payload');
    this.current = {
      status: 'installing',
      version: PIN.version,
      phase: 'Downloading runtime',
      downloadedBytes: 0,
      totalBytes: PIN.size,
      error: null,
    };
    try {
      const space = fs.statfsSync(this.root, { bigint: true });
      if (space.bavail * space.bsize < BigInt(PIN.size + 1_000_000_000))
        throw new Error(
          'Free at least 1.2 GB on the Loadstone workspace drive before preparing the engine.',
        );
      fs.mkdirSync(unpacked, { recursive: true });
      if (archiveForVerification) {
        fs.copyFileSync(archiveForVerification, archive);
        this.current.downloadedBytes = fs.statSync(archive).size;
      } else {
        const response = await fetch(PIN.url, { signal });
        if (
          !response.ok ||
          !response.body ||
          new URL(response.url).protocol !== 'https:'
        )
          throw new Error(
            'Could not download the official Wabbajack runtime. Try again when the connection is available.',
          );
        const monitor = new Transform({
          transform: (chunk, _, callback) => {
            this.current.downloadedBytes += chunk.length;
            if (this.current.downloadedBytes > PIN.size)
              callback(
                new Error('The runtime download exceeds its expected size.'),
              );
            else callback(null, chunk);
          },
        });
        await pipeline(
          response.body,
          monitor,
          fs.createWriteStream(archive, { flags: 'wx' }),
          { signal },
        );
      }
      this.current.phase = 'Checking download';
      if (
        fs.statSync(archive).size !== PIN.size ||
        (await sha256(archive)) !== PIN.sha256
      )
        throw new Error(
          'The runtime download failed its SHA-256 integrity check.',
        );
      signal.throwIfAborted();
      this.current.phase = 'Preparing runtime';
      const files = await extractZip(archive, unpacked, signal);
      if (
        crypto
          .createHash('sha256')
          .update(JSON.stringify(files))
          .digest('hex') !== PIN.inventoryHash
      )
        throw new Error(
          'The extracted runtime does not match the pinned release.',
        );
      this.current.phase = 'Testing installer interface';
      await inspectRuntime(unpacked, this.work);
      signal.throwIfAborted();
      fs.writeFileSync(
        path.join(unpacked, '.loadstone-inventory.json'),
        JSON.stringify({
          version: PIN.version,
          archiveHash: PIN.sha256,
          files,
        }),
        { flush: true, flag: 'wx' },
      );
      // Only manager-owned, canonically resolved siblings are renamed. Keep the
      // prior runtime recoverable if this is a repair rather than deleting it.
      if (fs.existsSync(this.directory)) {
        if (!contains(this.root, fs.realpathSync(this.directory)))
          throw new Error('Runtime location points outside Loadstone.');
        fs.renameSync(this.directory, this.directory + `.backup-${Date.now()}`);
      }
      fs.renameSync(unpacked, this.directory);
      this.current.status = 'ready';
      this.current.phase = 'Runtime verified';
    } catch (error) {
      this.current.status = signal.aborted ? 'missing' : 'error';
      this.current.phase = signal.aborted
        ? 'Installation cancelled'
        : 'Installation failed';
      this.current.error = signal.aborted ? null : error.message;
      throw error;
    } finally {
      this.controller = null;
      if (fs.existsSync(stage)) {
        const resolved = fs.realpathSync(stage);
        if (
          contains(this.root, resolved) &&
          resolved !== this.root &&
          path.basename(resolved).startsWith('.stage-')
        )
          fs.rmSync(resolved, { recursive: true, force: true });
      }
    }
    return this.status();
  }
}
module.exports = {
  Runtime,
  PIN,
  extractZip,
  inspectRuntime,
  parseGameLocations,
};

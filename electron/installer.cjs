const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { canonical, contains, sha256 } = require('./live-catalog.cjs');
const { validateManifest } = require('./manifest.cjs');
const active = new Set(['preparing', 'installing', 'verifying']);
const statuses = new Set([
  ...active,
  'installed',
  'failed',
  'cancelled',
  'interrupted',
  'removing',
  'removed',
  'removal-failed',
]);
async function bootIdentifier() {
  if (process.platform !== 'win32')
    throw new Error('Live installations currently require Windows.');
  return new Promise((resolve, reject) =>
    execFile(
      path.join(
        process.env.SystemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString("o")',
      ],
      { windowsHide: true, timeout: 15000 },
      (error, stdout) => {
        const value = stdout?.trim();
        if (error || !/^\d{4}-\d{2}-\d{2}T/.test(value))
          reject(
            new Error(
              'Could not record the Windows session for installation recovery.',
            ),
          );
        else resolve(value);
      },
    ),
  );
}
function redact(line, secret = '') {
  let value = String(line);
  if (secret) value = value.split(secret).join('[redacted]');
  return value
    .replace(/https?:\/\/[^\s"<>]+/gi, (url) => {
      try {
        const u = new URL(url);
        return u.origin + u.pathname + (u.search ? '?[redacted]' : '');
      } catch {
        return '[URL]';
      }
    })
    .replace(
      /(apikey|authorization|access_token|refresh_token)\s*[:=]\s*\S+/gi,
      '$1=[redacted]',
    )
    .replace(/[\x00-\x08\x0b-\x1f]/g, '')
    .slice(0, 1000);
}
function owned(job) {
  const root = canonical(job.destination);
  if (root.toLowerCase() !== path.resolve(job.destination).toLowerCase())
    throw new Error('The setup folder now points to another location.');
  const owner = JSON.parse(
    fs.readFileSync(path.join(root, '.loadstone-owner.json'), 'utf8'),
  );
  if (owner.jobId !== job.id || owner.setupId !== job.setupId)
    throw new Error('This folder is not owned by this installation.');
  return root;
}
function sanitizeEngineLogs(job, key) {
  const root = owned(job),
    logs = path.join(root, 'work', 'logs');
  if (!fs.existsSync(logs)) return;
  if (!contains(root, canonical(logs)))
    throw new Error('The installer log folder points outside this setup.');
  for (const name of fs.readdirSync(logs)) {
    if (!/^wabbajack-cli.*\.log$/i.test(name)) continue;
    const file = path.join(logs, name);
    if (!contains(logs, canonical(file)) || !fs.statSync(file).isFile())
      throw new Error('An installer log points outside its log folder.');
    const text =
      fs.statSync(file).size <= 10_000_000
        ? fs
            .readFileSync(file, 'utf8')
            .split(/\r?\n/)
            .map((line) => redact(line, key))
            .join('\n')
        : 'Oversized engine log omitted. Review the bounded installation output in Loadstone.';
    fs.writeFileSync(file, text);
  }
}
function verifyProfile(job) {
  const root = owned(job),
    output = path.join(root, 'profile');
  const files = [
    'ModOrganizer.exe',
    'ModOrganizer.ini',
    `profiles/${job.manifest.launch.profile}/modlist.txt`,
  ];
  for (const file of files) {
    const target = canonical(path.join(output, file));
    if (
      !contains(output, target) ||
      !fs.statSync(target).isFile() ||
      fs.statSync(target).size === 0
    )
      throw new Error(
        `The installed profile is missing a required file: ${file}`,
      );
  }
  const fd = fs.openSync(path.join(output, 'ModOrganizer.exe'), 'r');
  try {
    const header = Buffer.alloc(2);
    fs.readSync(fd, header, 0, 2, 0);
    if (header.toString() !== 'MZ')
      throw new Error('The installed mod manager is not a Windows executable.');
  } finally {
    fs.closeSync(fd);
  }
  const iniFile = path.join(output, 'ModOrganizer.ini');
  if (fs.statSync(iniFile).size > 2_000_000)
    throw new Error('The mod manager configuration is too large.');
  const ini = fs.readFileSync(iniFile, 'utf8'),
    records = new Map();
  let section = '';
  for (const line of ini.split(/\r?\n/)) {
    const heading = line.match(/^\[([^\]]+)\]/);
    if (heading) {
      section = heading[1];
      continue;
    }
    if (section !== 'customExecutables') continue;
    const entry = line.match(/^(\d+)\\(title|binary)=(.*)$/);
    if (entry) {
      const item = records.get(entry[1]) || {};
      item[entry[2]] = entry[3].replace(/^"(.*)"$/, '$1');
      records.set(entry[1], item);
    }
  }
  const launch = [...records.values()].find(
    (item) => item.title === job.manifest.launch.executable,
  );
  if (!launch?.binary)
    throw new Error(
      'The declared launch entry is missing from the installed mod manager.',
    );
  const binary = canonical(path.resolve(output, launch.binary));
  if (
    (!contains(root, binary) && !contains(canonical(job.gameFolder), binary)) ||
    !fs.statSync(binary).isFile()
  )
    throw new Error(
      'The configured game executable is missing or outside the setup and game folders.',
    );
  return {
    manager: path.join(output, 'ModOrganizer.exe'),
    profile: job.manifest.launch.profile,
    executable: job.manifest.launch.executable,
  };
}
class Installer {
  constructor(root, catalog, runtime, nexus, options = {}) {
    this.file = path.join(root, 'live-jobs.json');
    this.catalog = catalog;
    this.runtime = runtime;
    this.nexus = nexus;
    this.spawn = options.spawn || spawn;
    this.verifyProfile = options.verifyProfile || verifyProfile;
    this.bootIdentifier = options.bootIdentifier || bootIdentifier;
    this.onInstalled = options.onInstalled || (() => {});
    this.credentialFile =
      options.credentialFile ||
      path.join(
        process.env.LOCALAPPDATA || root,
        'Wabbajack',
        'encrypted',
        'nexus-oauth-info',
      );
    this.jobs = [];
    this.running = null;
    this.starting = false;
    if (fs.existsSync(this.file)) {
      if (fs.statSync(this.file).size > 10_000_000)
        throw new Error('The saved installation history is too large.');
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (
        saved.schemaVersion !== 1 ||
        !Array.isArray(saved.jobs) ||
        saved.jobs.length > 1000
      )
        throw new Error('Unsupported live installation state.');
      const ids = new Set();
      for (const job of saved.jobs) {
        if (
          !job ||
          !/^[a-f0-9-]{36}$/.test(job.id) ||
          ids.has(job.id) ||
          !statuses.has(job.status) ||
          ![job.destination, job.gameFolder].every(
            (p) =>
              typeof p === 'string' && path.isAbsolute(p) && p.length < 1024,
          ) ||
          !Array.isArray(job.logs) ||
          job.logs.length > 150 ||
          job.logs.some(
            (line) => typeof line !== 'string' || line.length > 1000,
          )
        )
          throw new Error('Invalid saved installation history.');
        ids.add(job.id);
        validateManifest(job.manifest);
        if (job.setupId !== job.manifest.id)
          throw new Error('Invalid saved installation identity.');
        if (active.has(job.status)) {
          job.status = 'interrupted';
          job.error =
            'Loadstone closed during installation. Restart Windows before retrying to ensure the previous installer has stopped.';
        }
        if (job.status === 'removing') {
          job.status = 'removal-failed';
          job.error =
            'Loadstone closed during removal. Resume removal to finish cleanup; preserved data remains in the setup or recovery folder.';
        }
      }
      this.jobs = saved.jobs;
      this.save(this.jobs);
    }
  }
  save(jobs) {
    fs.writeFileSync(
      this.file + '.tmp',
      JSON.stringify({ schemaVersion: 1, jobs }, null, 2),
      { flush: true },
    );
    fs.renameSync(this.file + '.tmp', this.file);
  }
  list() {
    return this.jobs.map(({ manifest, ...job }) =>
      structuredClone({ ...job, version: manifest.version }),
    );
  }
  change(id, patch) {
    const jobs = this.jobs.map((job) =>
      job.id === id
        ? { ...job, ...patch, updatedAt: new Date().toISOString() }
        : job,
    );
    this.save(jobs);
    this.jobs = jobs;
  }
  async preflight(options, ownedId = null, entryOverride = null) {
    const result = await this.catalog.preflight(
      options,
      this.runtime.status().version,
      ownedId,
      entryOverride,
    );
    result.checks = result.checks.filter(
      (check) => check.name !== 'Installer connection',
    );
    const add = async (name, fn) => {
      try {
        result.checks.push({ name, status: 'pass', detail: await fn() });
      } catch (error) {
        result.checks.push({ name, status: 'fail', detail: error.message });
      }
    };
    await add('Installation engine', async () => {
      if ((await this.runtime.verify()).status !== 'ready')
        throw new Error('Install or repair the engine in Settings.');
      return `Wabbajack ${this.runtime.status().version} verified.`;
    });
    if (this.runtime.status().status === 'ready')
      await add('Engine game selection', async () => {
        const manifest =
          entryOverride?.manifest ||
          this.catalog.list().find((item) => item.id === options.id);
        const game = (await this.runtime.gameLocations()).find(
          (item) => item.id === manifest.game.id,
        );
        if (!game)
          throw new Error('Wabbajack could not find the selected game.');
        if (
          canonical(game.folder).toLowerCase() !==
          canonical(options.gameFolder).toLowerCase()
        )
          throw new Error(
            `Wabbajack selected another installation. Choose this game folder: ${game.folder}`,
          );
        return `Wabbajack selected the same game folder (${game.version}).`;
      });
    if (result.list?.requiresNexus)
      await add('Nexus download access', async () => {
        if (fs.existsSync(this.credentialFile))
          throw new Error(
            'Wabbajack has a saved Nexus login that would override this connection. Sign out of Nexus in Wabbajack before using the Loadstone account.',
          );
        const account = await this.nexus.verify();
        if (!account.premium)
          throw new Error(
            'This list requires automatic Nexus downloads. Premium access is required until the manual-download workflow is available.',
          );
        return `Download access verified for ${account.name}.`;
      });
    result.ready = result.checks.every((check) => check.status === 'pass');
    return result;
  }
  async start(options, retryId = null) {
    if (this.starting || this.running || this.maintenance)
      throw new Error('Another installation is already running.');
    this.starting = true;
    try {
      let job = retryId ? this.jobs.find((item) => item.id === retryId) : null;
      if (
        retryId &&
        (!job || !['failed', 'cancelled', 'interrupted'].includes(job.status))
      )
        throw new Error('This job cannot be retried.');
      const boot = await this.bootIdentifier();
      if (job?.status === 'interrupted' && (!job.bootId || job.bootId === boot))
        throw new Error(
          'Restart Windows before retrying this interrupted installation so the previous installer and its workers have stopped.',
        );
      let entry = this.catalog.entries.find(
        (item) => item.manifest.id === (job?.setupId || options.id),
      );
      if (job) {
        owned(job);
        if (fs.existsSync(path.join(job.destination, 'list.wabbajack'))) {
          entry = {
            folder: job.destination,
            manifest: structuredClone(job.manifest),
          };
          entry.manifest.archive.file = 'list.wabbajack';
        } else if (
          !entry ||
          JSON.stringify(entry.manifest) !== JSON.stringify(job.manifest)
        ) {
          throw new Error(
            'The original list archive is unavailable. Restore the owned list.wabbajack archive before retrying.',
          );
        }
        options = {
          id: job.setupId,
          gameFolder: job.gameFolder,
          destination: job.destination,
        };
      } else if (
        this.jobs.some(
          (item) =>
            item.setupId === options.id &&
            item.manifest.version === entry?.manifest.version &&
            item.status === 'installed',
        )
      )
        throw new Error('This setup version is already installed.');
      if (!job) {
        const target = canonical(options.destination);
        for (const existing of this.jobs) {
          for (const location of [
            existing.status !== 'removed' && existing.destination,
            existing.removalRecoveryPath,
          ].filter(Boolean)) {
            const old = canonical(location);
            if (contains(old, target) || contains(target, old))
              throw new Error(
                'Choose a separate folder outside existing installations and recovery folders.',
              );
          }
        }
        const installed = this.jobs.filter(
          (item) => item.setupId === options.id && item.status === 'installed',
        );
        if (
          installed.some(
            (item) =>
              !entry?.manifest.update?.fromVersions.includes(
                item.manifest.version,
              ),
          )
        )
          throw new Error(
            'The creator has not declared an update from an installed version.',
          );
      }
      const result = await this.preflight(options, job?.id, entry);
      if (!result.ready)
        throw new Error(
          result.checks
            .filter((check) => check.status === 'fail')
            .map((check) => check.detail)
            .join('\n'),
        );
      if (
        this.runtime.controller ||
        this.runtime.verifying ||
        this.runtime.inUse
      )
        throw new Error('The installation engine is busy.');
      this.runtime.inUse = true;

      if (!job) {
        if (this.jobs.length >= 1000)
          throw new Error('Installation history is full.');
        job = {
          id: crypto.randomUUID(),
          setupId: options.id,
          name: entry.manifest.name,
          destination: canonical(options.destination),
          gameFolder: canonical(options.gameFolder),
          manifest: structuredClone(entry.manifest),
          bootId: boot,
          status: 'preparing',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          logs: [],
          error: null,
        };
        const jobs = [...this.jobs, job];
        this.save(jobs);
        this.jobs = jobs;
        fs.mkdirSync(job.destination, { recursive: true });
        if (fs.readdirSync(job.destination).length)
          throw new Error(
            'The installation folder changed after preflight. Choose an empty folder.',
          );
        fs.writeFileSync(
          path.join(job.destination, '.loadstone-owner.json'),
          JSON.stringify({ jobId: job.id, setupId: job.setupId }),
          { flag: 'wx', flush: true },
        );
      } else
        this.change(job.id, { status: 'preparing', error: null, bootId: boot });
      const root = owned(job);
      for (const name of ['downloads', 'work', 'profile', 'list.wabbajack']) {
        const target = path.join(root, name);
        if (canonical(target).toLowerCase() !== target.toLowerCase())
          throw new Error(
            'An installation path now points to another location.',
          );
      }
      fs.mkdirSync(path.join(root, 'downloads'), { recursive: true });
      fs.mkdirSync(path.join(root, 'work'), { recursive: true });
      const archive = path.join(root, 'list.wabbajack');
      if (!fs.existsSync(archive))
        await fs.promises.copyFile(
          path.join(entry.folder, entry.manifest.archive.file),
          archive,
          fs.constants.COPYFILE_EXCL,
        );
      if ((await sha256(archive)) !== job.manifest.archive.sha256)
        throw new Error(
          'The owned list archive does not match this installation.',
        );
      let key = '';
      if (result.list?.requiresNexus) {
        if (fs.existsSync(this.credentialFile))
          throw new Error(
            'The Wabbajack account changed after preflight. Check the account connection again.',
          );
        key = this.nexus.read().key;
      }
      this.change(job.id, { status: 'installing' });
      this.running = { id: job.id, child: null, cancelled: false };
      void this.execute(job, key).catch(() => {});
      return this.list();
    } catch (error) {
      this.runtime.inUse = false;
      const unfinished = this.jobs.find((item) => item.status === 'preparing');
      if (unfinished)
        this.change(unfinished.id, { status: 'failed', error: error.message });
      throw error;
    } finally {
      this.starting = false;
    }
  }
  async execute(job, key) {
    const run = this.running,
      logs = [],
      output = path.join(job.destination, 'profile');
    let buffer = '',
      lastSave = 0;
    const record = (chunk) => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 16000) buffer = buffer.slice(-16000);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      logs.push(...lines.map((line) => redact(line, key)).filter(Boolean));
      if (logs.length > 150) logs.splice(0, logs.length - 150);
      if (Date.now() - lastSave > 1000) {
        lastSave = Date.now();
        try {
          this.change(job.id, { logs: [...logs] });
        } catch {
          run.cancelled = true;
          void this.cancel(job.id).catch(() => {});
        }
      }
    };
    try {
      const env = { ...process.env };
      delete env.NEXUS_API_KEY;
      delete env.NEXUS_OAUTH_INFO;
      if (key) env.NEXUS_API_KEY = key;
      const code = await new Promise((resolve, reject) => {
        const child = this.spawn(
          path.join(this.runtime.directory, 'wabbajack-cli.exe'),
          [
            'install',
            '-w',
            path.join(job.destination, 'list.wabbajack'),
            '-o',
            output,
            '-d',
            path.join(job.destination, 'downloads'),
          ],
          {
            cwd: path.join(job.destination, 'work'),
            env,
            windowsHide: true,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        run.child = child;
        child.stdout.on('data', record);
        child.stderr.on('data', record);
        child.once('error', () =>
          reject(
            new Error(
              'The installation engine could not start. Repair it in Settings.',
            ),
          ),
        );
        child.once('close', resolve);
      });
      if (buffer) logs.push(redact(buffer, key));
      sanitizeEngineLogs(job, key);
      if (run.cancelled) {
        this.change(job.id, {
          status: 'cancelled',
          logs: logs.slice(-150),
          error:
            'Installation stopped. Downloaded archives and partial files were preserved for retry.',
        });
        return;
      }
      if (code !== 0)
        throw new Error(
          `Wabbajack stopped with exit code ${code}. Review the installation output before retrying.`,
        );
      this.change(job.id, { status: 'verifying', logs: logs.slice(-150) });
      this.verifyProfile(job);
      this.change(job.id, {
        status: 'installed',
        installedAt: new Date().toISOString(),
        error: null,
      });
      try {
        await this.onInstalled(job.id);
      } catch (error) {
        try {
          this.change(job.id, { shortcutError: redact(error.message) });
        } catch {
          /* Installation completion is already durable. */
        }
      }
    } catch (error) {
      try {
        this.change(job.id, {
          status: 'failed',
          error: redact(error.message, key),
          logs: logs.slice(-150),
        });
      } catch {
        /* Keep the previous durable state for restart recovery. */
      }
    } finally {
      key = '';
      this.running = null;
      this.runtime.inUse = false;
    }
  }
  async cancel(id) {
    const run = this.running;
    if (!run || run.id !== id)
      throw new Error('This installation is not running.');
    run.cancelled = true;
    const child = run.child;
    if (child?.pid && child.exitCode === null) {
      if (process.platform === 'win32')
        await new Promise((resolve) =>
          execFile(
            'taskkill.exe',
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true },
            () => resolve(),
          ),
        );
      else child.kill('SIGTERM');
    }
    return this.list();
  }
}
module.exports = { Installer, verifyProfile, owned, redact };

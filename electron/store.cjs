const { replaceStateFile } = require('./replace-state-file.cjs');
const fs = require('node:fs');
const path = require('node:path');
const {
  validateState,
  validateSettings,
  absoluteDirectory,
} = require('./state-schema.cjs');
const ids = new Set(['mojave', 'northern', 'commonwealth']);
const active = new Set(['queued', 'downloading', 'extracting', 'configuring']);
function initial(root) {
  return {
    schemaVersion: 2,
    settings: {
      dummyData: true,
      onboardingComplete: false,
      installRoot: path.join(root, 'Setups'),
      reducedMotion: false,
      desktopShortcut: true,
      steamShortcut: true,
    },
    jobs: [],
    installed: [],
    logs: [
      'Welcome to Loadstone. Demo mode is enabled; no game files will be changed.',
    ],
  };
}
class Store {
  constructor(root) {
    fs.mkdirSync(root, { recursive: true });
    this.file = path.join(root, 'state.json');
    this.state = initial(root);
    if (fs.existsSync(this.file)) {
      let saved;
      try {
        saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (Number.isInteger(saved?.schemaVersion) && saved.schemaVersion > 2) {
          const error = new Error(
            'This workspace was saved by a newer Loadstone version. Update the app before opening it. Your data has not been changed.',
          );
          error.code = 'NEWER_STATE';
          throw error;
        }
        const candidate = {
          ...saved,
          schemaVersion: saved.schemaVersion === 1 ? 2 : saved.schemaVersion,
          settings: {
            ...this.state.settings,
            ...(saved.schemaVersion === 1 ? { onboardingComplete: true } : {}),
            ...saved.settings,
          },
        };
        this.state = validateState(candidate);
        for (const job of this.state.jobs)
          if (active.has(job.status)) {
            job.previousStatus = job.status;
            job.status = 'paused';
          }
      } catch (error) {
        if (error.code === 'NEWER_STATE') throw error;
        fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`);
        this.state = initial(root);
        this.log(
          'Recovered from an unreadable settings file. A backup was preserved.',
        );
      }
    }
    this.save();
  }
  save() {
    validateState(this.state);
    const tmp = `${this.file}.tmp`;
    const serialized = JSON.stringify(this.state, null, 2);
    fs.writeFileSync(tmp, serialized, { flush: true });
    replaceStateFile(tmp, this.file);
    return this.state;
  }
  log(message) {
    this.state.logs.push(`${new Date().toISOString()}  ${message}`);
    this.state.logs = this.state.logs.slice(-300);
  }
  guard(id) {
    if (!this.state.settings.dummyData)
      throw new Error(
        'Enable dummy data in Settings to use the demo installer.',
      );
    if (id && !ids.has(id)) throw new Error('Unknown setup.');
  }
  settings(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch))
      throw new Error('Invalid settings.');
    for (const [key, value] of Object.entries(patch)) {
      if (
        [
          'dummyData',
          'onboardingComplete',
          'reducedMotion',
          'desktopShortcut',
          'steamShortcut',
        ].includes(key)
      ) {
        if (typeof value !== 'boolean')
          throw new Error('Invalid setting value.');
      } else if (key === 'installRoot') {
        if (
          typeof value !== 'string' ||
          !path.isAbsolute(value) ||
          value.length > 1024
        )
          throw new Error('Choose an absolute installation folder.');
      } else throw new Error('Unknown setting.');
    }
    const settings = { ...this.state.settings, ...patch };
    validateSettings(settings);
    this.state.settings = settings;
    if (!this.state.settings.dummyData)
      for (const job of this.state.jobs)
        if (active.has(job.status)) {
          job.previousStatus = job.status;
          job.status = 'paused';
        }
    this.log(`Settings updated: ${Object.keys(patch).join(', ')}.`);
    return this.save();
  }
  install(options) {
    if (!options || typeof options !== 'object')
      throw new Error('Invalid install options.');
    this.guard();
    if (!ids.has(options.setupId)) throw new Error('Unknown setup.');
    if (!absoluteDirectory(options.destination))
      throw new Error('Choose an absolute installation folder.');
    if (
      typeof options.desktopShortcut !== 'boolean' ||
      typeof options.steamShortcut !== 'boolean'
    )
      throw new Error('Invalid shortcut options.');
    if (this.state.installed.some((x) => x.setupId === options.setupId))
      throw new Error('This setup is already installed.');
    if (
      this.state.jobs.some(
        (x) =>
          x.setupId === options.setupId &&
          (active.has(x.status) || x.status === 'paused'),
      )
    )
      throw new Error('This setup already has an installation in progress.');
    if (
      Object.keys(options).some(
        (key) =>
          ![
            'setupId',
            'destination',
            'desktopShortcut',
            'steamShortcut',
          ].includes(key),
      )
    )
      throw new Error('Unknown installation option.');
    this.state.jobs.push({
      setupId: options.setupId,
      destination: options.destination,
      desktopShortcut: options.desktopShortcut,
      steamShortcut: options.steamShortcut,
      id: crypto.randomUUID(),
      progress: 0,
      status: 'queued',
      createdAt: new Date().toISOString(),
    });
    this.log(
      `Demo installation queued: ${options.setupId}. No files or shortcuts are created.`,
    );
    return this.save();
  }
  job(action, id) {
    this.guard();
    const job = this.state.jobs.find((x) => x.id === id);
    if (!job) throw new Error('Installation not found.');
    if (action === 'pause' && active.has(job.status)) {
      job.previousStatus = job.status;
      job.status = 'paused';
    } else if (action === 'resume' && job.status === 'paused')
      job.status = job.previousStatus || 'downloading';
    else if (
      action === 'cancel' &&
      (active.has(job.status) || job.status === 'paused')
    )
      job.status = 'cancelled';
    else if (action === 'retry' && job.status === 'cancelled') {
      if (
        this.state.installed.some((x) => x.setupId === job.setupId) ||
        this.state.jobs.some(
          (x) =>
            x.id !== id &&
            x.setupId === job.setupId &&
            (active.has(x.status) || x.status === 'paused'),
        )
      )
        throw new Error('A setup or active installation already exists.');
      job.progress = 0;
      job.status = 'queued';
    } else if (
      action === 'clear' &&
      ['complete', 'cancelled'].includes(job.status)
    )
      this.state.jobs = this.state.jobs.filter((x) => x.id !== id);
    else throw new Error('This action is not available for this installation.');
    this.log(`Demo job ${action}: ${job.setupId}.`);
    return this.save();
  }
  tick() {
    if (!this.state.settings.dummyData) return false;
    const job = this.state.jobs.find((x) => active.has(x.status));
    if (!job) return false;
    const before = job.status;
    job.progress = Math.min(100, job.progress + 2);
    job.status =
      job.progress < 65
        ? 'downloading'
        : job.progress < 85
          ? 'extracting'
          : job.progress < 100
            ? 'configuring'
            : 'complete';
    if (before !== job.status) this.log(`Demo ${job.setupId}: ${job.status}.`);
    if (job.status === 'complete')
      this.state.installed.push({
        setupId: job.setupId,
        installedAt: new Date().toISOString(),
        destination: job.destination,
        desktopShortcut: job.desktopShortcut,
        steamShortcut: job.steamShortcut,
        sessions: 0,
      });
    this.save();
    return true;
  }
  library(action, id) {
    this.guard(id);
    const item = this.state.installed.find((x) => x.setupId === id);
    if (!item) throw new Error('Setup not installed.');
    if (action === 'play') {
      item.sessions++;
      item.lastPlayed = new Date().toISOString();
      this.log(`Demo session started: ${id}. No game process was launched.`);
    } else if (action === 'verify')
      this.log(
        `Demo verification passed: ${id}. Simulated profile and shortcut checks completed.`,
      );
    else if (action === 'uninstall') {
      this.state.installed = this.state.installed.filter(
        (x) => x.setupId !== id,
      );
      this.log(
        `Demo setup removed: ${id}. No game files or saves were touched.`,
      );
    } else throw new Error('Unknown library action.');
    return this.save();
  }
  reset() {
    this.guard();
    this.state.jobs = [];
    this.state.installed = [];
    this.state.logs = [];
    this.log('Demo data reset. Settings preserved.');
    return this.save();
  }
}
// Mutations are committed only after a successful durable save. A disk error or
// validation failure must not leave the in-memory workspace ahead of the file.
for (const method of [
  'settings',
  'install',
  'job',
  'tick',
  'library',
  'reset',
]) {
  const mutate = Store.prototype[method];
  Store.prototype[method] = function (...args) {
    const before = structuredClone(this.state);
    try {
      return mutate.apply(this, args);
    } catch (error) {
      this.state = before;
      throw error;
    }
  };
}
module.exports = { Store };

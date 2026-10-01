const path = require('node:path');
const setupIds = new Set(['mojave', 'northern', 'commonwealth']);
const runningStatuses = new Set([
  'queued',
  'downloading',
  'extracting',
  'configuring',
]);
const statuses = new Set([
  ...runningStatuses,
  'paused',
  'complete',
  'cancelled',
]);
const settingKeys = [
  'dummyData',
  'installRoot',
  'reducedMotion',
  'desktopShortcut',
  'steamShortcut',
];
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value, max = 1024) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    !value.includes('\0')
  );
}
function absoluteDirectory(value) {
  return text(value) && path.isAbsolute(value);
}
function timestamp(value) {
  return text(value, 64) && Number.isFinite(Date.parse(value));
}
function demand(condition, message) {
  if (!condition) throw new Error(message);
}
function validateSettings(settings) {
  demand(record(settings), 'Invalid settings.');
  demand(
    Object.keys(settings).every((key) => settingKeys.includes(key)),
    'Unknown setting.',
  );
  for (const key of settingKeys.filter((key) => key !== 'installRoot'))
    demand(typeof settings[key] === 'boolean', `Invalid setting: ${key}.`);
  demand(
    absoluteDirectory(settings.installRoot),
    'Choose an absolute installation folder.',
  );
}
function validateState(state) {
  demand(
    record(state) && state.schemaVersion === 1,
    'Unsupported state schema.',
  );
  validateSettings(state.settings);
  for (const key of ['jobs', 'installed', 'logs'])
    demand(
      Array.isArray(state[key]) &&
        state[key].length <= (key === 'logs' ? 300 : 1000),
      `Invalid saved ${key}.`,
    );
  demand(
    state.logs.every((log) => text(log, 8192)),
    'Invalid activity log.',
  );
  const seenJobs = new Set(),
    activeSetups = new Set(),
    installedSetups = new Set();
  for (const job of state.jobs) {
    demand(
      record(job) && text(job.id, 64) && !seenJobs.has(job.id),
      'Invalid or duplicate job ID.',
    );
    seenJobs.add(job.id);
    demand(
      setupIds.has(job.setupId) && statuses.has(job.status),
      'Invalid saved installation.',
    );
    demand(
      Number.isFinite(job.progress) && job.progress >= 0 && job.progress <= 100,
      'Invalid installation progress.',
    );
    demand(
      job.status !== 'complete' || job.progress === 100,
      'Completed installation has incomplete progress.',
    );
    demand(
      job.previousStatus === undefined ||
        runningStatuses.has(job.previousStatus),
      'Invalid resume state.',
    );
    demand(
      absoluteDirectory(job.destination) && timestamp(job.createdAt),
      'Invalid installation location or date.',
    );
    demand(
      typeof job.desktopShortcut === 'boolean' &&
        typeof job.steamShortcut === 'boolean',
      'Invalid installation shortcuts.',
    );
    if (runningStatuses.has(job.status) || job.status === 'paused') {
      demand(!activeSetups.has(job.setupId), 'Duplicate active installation.');
      activeSetups.add(job.setupId);
    }
  }
  for (const item of state.installed) {
    demand(
      record(item) &&
        setupIds.has(item.setupId) &&
        !installedSetups.has(item.setupId),
      'Invalid or duplicate installed setup.',
    );
    installedSetups.add(item.setupId);
    demand(
      !activeSetups.has(item.setupId),
      'Installed setup has an active installation.',
    );
    demand(
      absoluteDirectory(item.destination) && timestamp(item.installedAt),
      'Invalid installed location or date.',
    );
    demand(
      item.lastPlayed === undefined || timestamp(item.lastPlayed),
      'Invalid play history.',
    );
    demand(
      Number.isSafeInteger(item.sessions) && item.sessions >= 0,
      'Invalid session count.',
    );
    demand(
      typeof item.desktopShortcut === 'boolean' &&
        typeof item.steamShortcut === 'boolean',
      'Invalid installed shortcuts.',
    );
  }
  return state;
}
module.exports = {
  validateState,
  validateSettings,
  absoluteDirectory,
  runningStatuses,
};

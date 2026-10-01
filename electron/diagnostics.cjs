const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../package.json');
const known = (value, values) => (values.includes(value) ? value : 'unknown');
function errorSummary(value) {
  if (!value) return null;
  const message = String(value);
  const categories = [
    ['storage', /disk|space|EACCES|EPERM|permission|write|save/i],
    ['credentials', /Nexus|Premium|credential|account|API key/i],
    ['integrity', /hash|integrity|checksum|match|corrupt/i],
    ['missing-files', /missing|ENOENT|not found|unavailable/i],
    ['interrupted', /interrupted|Restart Windows|stopped|cancel/i],
    ['network', /network|download|connection|timeout/i],
  ];
  const exit = message.match(/exit(?:ed)?(?: with)? code (-?\d{1,10})/i);
  return {
    category:
      categories.find(([, pattern]) => pattern.test(message))?.[0] || 'other',
    exitCode: exit ? Number(exit[1]) : null,
  };
}
function buildInfo() {
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../dist/build-info.json'), 'utf8'),
    );
    return {
      commit: /^[a-f0-9]{40}$/.test(data.commit) ? data.commit : null,
      dirty: typeof data.dirty === 'boolean' ? data.dirty : null,
      lockfileSha256: /^[a-f0-9]{64}$/.test(data.lockfileSha256)
        ? data.lockfileSha256
        : null,
    };
  } catch {
    return { commit: null, dirty: null, lockfileSha256: null };
  }
}
function diagnostics({ state, engine, account, jobs }) {
  return {
    schemaVersion: 1,
    product: 'Loadstone',
    version,
    build: buildInfo(),
    exportedAt: new Date().toISOString(),
    system: {
      platform: process.platform,
      architecture: process.arch,
      release: os.release(),
      electron: process.versions.electron || null,
      node: process.versions.node,
    },
    mode: state.settings.dummyData ? 'demo' : 'live',
    preferences: {
      reducedMotion: Boolean(state.settings.reducedMotion),
      desktopShortcut: Boolean(state.settings.desktopShortcut),
      steamShortcut: Boolean(state.settings.steamShortcut),
    },
    engine: {
      version: /^\d+(\.\d+){2,3}$/.test(engine.version) ? engine.version : null,
      status: known(engine.status, [
        'missing',
        'installing',
        'checking',
        'ready',
        'error',
      ]),
      error: errorSummary(engine.error),
    },
    nexus: {
      encryptionAvailable: Boolean(account.available),
      connected: Boolean(account.connected),
      premium: typeof account.premium === 'boolean' ? account.premium : null,
      error: errorSummary(account.error),
    },
    demo: {
      jobs: state.jobs.length,
      installed: state.installed.length,
      activityLines: state.logs.length,
    },
    live: {
      totalJobs: jobs.length,
      recentJobs: jobs.slice(-25).map((job, index) => ({
        label: `Installation ${Math.max(0, jobs.length - 25) + index + 1}`,
        status: known(job.status, [
          'preparing',
          'installing',
          'verifying',
          'installed',
          'failed',
          'cancelled',
          'interrupted',
          'removing',
          'removed',
          'removal-failed',
        ]),
        error: errorSummary(job.error),
        desktopShortcutSaved: Boolean(job.desktopShortcut),
        desktopShortcutError: errorSummary(job.shortcutError),
        steamShortcutSaved: Boolean(job.steamShortcut),
        steamShortcutError: errorSummary(job.steamShortcutError),
        manager: job.launch
          ? known(job.launch.phase, ['starting', 'open', 'closed', 'error'])
          : null,
        outputLines: Array.isArray(job.logs) ? job.logs.length : 0,
      })),
    },
    exclusions: [
      'Credentials',
      'Account names and IDs',
      'Paths',
      'Manifest names and source URLs',
      'Raw activity and engine output',
    ],
    note: 'Error categories are automatic triage hints, not diagnoses. Review detailed installation output locally. This export is saved locally and is not uploaded.',
  };
}
module.exports = { diagnostics, errorSummary };

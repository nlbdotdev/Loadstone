import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { diagnostics, errorSummary } = require('../electron/diagnostics.cjs');
test('diagnostic reports exclude arbitrary text, secrets, account identifiers and paths', () => {
  const sensitive = 'PRIVATE-CANARY-C:\\Users\\person\\apikey=do-not-export';
  const job = {
    id: sensitive,
    name: sensitive,
    destination: sensitive,
    gameFolder: sensitive,
    status: 'failed',
    error: `Wabbajack stopped with exit code 42. ${sensitive}`,
    logs: [sensitive],
    shortcutError: 'EACCES ' + sensitive,
    steamShortcut: { accountId: sensitive, backup: sensitive },
    launch: { phase: 'error', message: sensitive },
    manifest: { author: sensitive },
  };
  const result = diagnostics({
    state: {
      settings: {
        dummyData: false,
        installRoot: sensitive,
        desktopShortcut: true,
      },
      jobs: [],
      installed: [],
      logs: [sensitive],
    },
    engine: {
      version: '4.2.3.0',
      status: 'ready',
      phase: sensitive,
      error: null,
    },
    account: {
      available: true,
      connected: true,
      premium: true,
      name: sensitive,
      key: sensitive,
      error: null,
    },
    jobs: Array.from({ length: 30 }, () => job),
  });
  const text = JSON.stringify(result);
  assert.equal(text.includes('PRIVATE-CANARY'), false);
  assert.equal(text.includes('do-not-export'), false);
  assert.equal(result.mode, 'live');
  assert.equal(result.live.totalJobs, 30);
  assert.equal(result.live.recentJobs.length, 25);
  assert.equal(result.live.recentJobs[0].label, 'Installation 6');
  assert.equal(result.live.recentJobs[0].error.exitCode, 42);
  assert.equal(
    result.live.recentJobs[0].desktopShortcutError.category,
    'storage',
  );
  assert.equal(result.nexus.premium, true);
});
test('diagnostic triage never emits original error text and unknown states are bounded', () => {
  assert.deepEqual(errorSummary('secret-password'), {
    category: 'other',
    exitCode: null,
  });
  assert.equal(errorSummary(null), null);
  assert.equal(
    errorSummary('Nexus rejected this API key').category,
    'credentials',
  );
  const result = diagnostics({
    state: { settings: {}, jobs: [], installed: [], logs: [] },
    engine: { version: 'secret', status: 'secret' },
    account: {},
    jobs: [{ status: 'secret', logs: [] }],
  });
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(result.engine.status, 'unknown');
  assert.equal(result.engine.version, null);
});

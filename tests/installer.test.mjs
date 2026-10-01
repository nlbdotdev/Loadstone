import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const {
  Installer,
  redact,
  verifyProfile,
} = require('../electron/installer.cjs');
function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-installer-'));
  fs.writeFileSync(path.join(root, 'source.wabbajack'), 'fixture');
  const manifest = {
    schemaVersion: 1,
    id: 'fixture-setup',
    name: 'Fixture',
    version: '1.0',
    description: 'Test fixture',
    author: 'Loadstone tests',
    website: 'https://example.com',
    game: {
      id: 'fnv',
      versions: ['fixture'],
      executableHashes: ['0'.repeat(64)],
      requiredFiles: [],
    },
    storage: { installBytes: 1024, downloadBytes: 1024 },
    archive: {
      file: 'source.wabbajack',
      sha256: crypto.createHash('sha256').update('fixture').digest('hex'),
      source: 'https://example.com',
    },
    launch: { manager: 'mo2', profile: 'Fixture', executable: 'Fixture game' },
    credits: [
      {
        name: 'Fixture',
        author: 'Loadstone tests',
        source: 'https://example.com',
        license: 'Test data',
      },
    ],
  };
  const options = {
    id: manifest.id,
    gameFolder: root,
    destination: path.join(root, 'destination'),
  };
  let requiresNexus = false,
    mode = 'success',
    boot = 'boot-1';
  const catalog = {
    entries: [{ manifest, folder: root }],
    list: () => [manifest],
    preflight: async () => ({
      ready: true,
      checks: [],
      list: { requiresNexus },
    }),
  };
  const runtime = {
    directory: root,
    status: () => ({ status: 'ready', version: '4.2.3.0' }),
    verify: async () => ({ status: 'ready' }),
    gameLocations: async () => [
      { id: 'fnv', folder: root, version: 'fixture' },
    ],
  };
  const installerOptions = {
    credentialFile: path.join(root, 'other-app-credential'),
    bootIdentifier: async () => boot,
    spawn: (_exe, args, options) => {
      assert.equal(options.shell, false);
      assert.equal(options.env.NEXUS_OAUTH_INFO, undefined);
      return spawn(
        process.execPath,
        [
          path.join(import.meta.dirname, 'fixtures', 'installer-child.cjs'),
          args[args.indexOf('-o') + 1],
          mode,
        ],
        options,
      );
    },
  };
  const nexus = {
    verify: async () => ({ name: 'Test account', premium: true }),
    read: () => ({ key: 'synthetic-test-secret' }),
  };
  const installer = new Installer(
    root,
    catalog,
    runtime,
    nexus,
    installerOptions,
  );
  return {
    root,
    options,
    installer,
    installerOptions,
    catalog,
    runtime,
    nexus,
    setMode: (value) => (mode = value),
    requireNexus: () => (requiresNexus = true),
    setBoot: (value) => (boot = value),
  };
}
async function finish(installer) {
  for (let i = 0; i < 100 && installer.running; i++)
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(installer.running, null);
}
test('live runner executes a child, verifies its profile, persists completion and redacts output', async () => {
  const h = harness();
  h.installer.onInstalled = () => {
    throw new Error('Desktop is unavailable');
  };
  await h.installer.start(h.options);
  await assert.rejects(h.installer.start(h.options), /already running/);
  await finish(h.installer);
  assert.equal(h.installer.list()[0].status, 'installed');
  assert.equal(h.installer.list()[0].shortcutError, 'Desktop is unavailable');
  assert.equal(
    JSON.stringify(h.installer.list()).includes('private-token'),
    false,
  );
  assert.equal(
    new Installer(
      h.root,
      h.catalog,
      h.runtime,
      h.nexus,
      h.installerOptions,
    ).list()[0].status,
    'installed',
  );
  const job = h.installer.jobs[0];
  fs.unlinkSync(path.join(job.destination, 'profile', 'ModOrganizer.exe'));
  assert.throws(() => verifyProfile(job));
});
test('failed installs retry owned folders and foreign ownership blocks reuse', async () => {
  const h = harness();
  h.setMode('fail');
  await h.installer.start(h.options);
  await finish(h.installer);
  const id = h.installer.list()[0].id;
  assert.equal(h.installer.list()[0].status, 'failed');
  fs.writeFileSync(
    path.join(h.options.destination, '.loadstone-owner.json'),
    '{}',
  );
  await assert.rejects(h.installer.start(null, id), /not owned/);
  fs.writeFileSync(
    path.join(h.options.destination, '.loadstone-owner.json'),
    JSON.stringify({ jobId: id, setupId: h.options.id }),
  );
  h.setMode('success');
  await h.installer.start(null, id);
  await finish(h.installer);
  assert.equal(h.installer.list()[0].status, 'installed');
});
test('conflicting external Nexus credentials block handoff and errors/logs redact secrets', async () => {
  const h = harness();
  h.requireNexus();
  fs.writeFileSync(h.installer.credentialFile, 'untouched credential');
  await assert.rejects(h.installer.start(h.options), /saved Nexus login/);
  assert.equal(
    fs.readFileSync(h.installer.credentialFile, 'utf8'),
    'untouched credential',
  );
  assert.equal(h.installer.list().length, 0);
  assert.equal(
    redact(
      'apikey=abc synthetic https://host/file?token=abc',
      'synthetic',
    ).includes('abc'),
    false,
  );
});
test('crashed job state is interrupted and retry requires a different Windows boot', async () => {
  const h = harness();
  h.setMode('fail');
  await h.installer.start(h.options);
  await finish(h.installer);
  h.installer.change(h.installer.jobs[0].id, { status: 'installing' });
  const restarted = new Installer(
    h.root,
    h.catalog,
    h.runtime,
    h.nexus,
    h.installerOptions,
  );
  assert.equal(restarted.list()[0].status, 'interrupted');
  await assert.rejects(
    restarted.start(null, restarted.list()[0].id),
    /Restart Windows/,
  );
  h.setBoot('boot-2');
  h.setMode('success');
  await restarted.start(null, restarted.list()[0].id);
  await finish(restarted);
  assert.equal(restarted.list()[0].status, 'installed');
});
test('stopping an active child waits for it to exit and preserves retry files', async () => {
  const h = harness();
  h.setMode('wait');
  await h.installer.start(h.options);
  const id = h.installer.list()[0].id;
  await h.installer.cancel(id);
  await finish(h.installer);
  assert.equal(h.installer.list()[0].status, 'cancelled');
  assert.equal(
    fs.existsSync(path.join(h.options.destination, 'list.wabbajack')),
    true,
  );
  h.setMode('success');
  await h.installer.start(null, id);
  await finish(h.installer);
  assert.equal(h.installer.list()[0].status, 'installed');
});

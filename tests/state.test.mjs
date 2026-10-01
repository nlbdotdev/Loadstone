import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { Store } = createRequire(import.meta.url)('../electron/store.cjs');
const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-state-'));
test('malformed nested state is backed up before recovery', () => {
  const root = folder(),
    store = new Store(root);
  const corrupt = { ...store.state, jobs: [null] };
  const bytes = JSON.stringify(corrupt);
  fs.writeFileSync(store.file, bytes);
  const recovered = new Store(root);
  assert.equal(recovered.state.jobs.length, 0);
  assert.match(recovered.state.logs.at(-1), /Recovered/);
  const backup = fs
    .readdirSync(root)
    .find((name) => name.includes('.corrupt-'));
  assert.equal(fs.readFileSync(path.join(root, backup), 'utf8'), bytes);
});
test('newer schema is never overwritten by an older app', () => {
  const root = folder(),
    file = path.join(root, 'state.json');
  const bytes = JSON.stringify({
    schemaVersion: 99,
    futureUserData: 'preserve me',
  });
  fs.writeFileSync(file, bytes);
  assert.throws(() => new Store(root), /newer Loadstone/);
  assert.equal(fs.readFileSync(file, 'utf8'), bytes);
});
test('invalid patches and simulated disk failures roll back memory and disk', () => {
  const root = folder(),
    store = new Store(root);
  const before = structuredClone(store.state),
    disk = fs.readFileSync(store.file, 'utf8');
  assert.throws(
    () => store.settings({ dummyData: false, installRoot: 55 }),
    /absolute/,
  );
  assert.deepEqual(store.state, before);
  assert.throws(
    () => store.settings(JSON.parse('{"__proto__":{"polluted":true}}')),
    /Unknown/,
  );
  const realSave = store.save;
  store.save = () => {
    throw new Error('disk full');
  };
  assert.throws(() => store.settings({ reducedMotion: true }), /disk full/);
  assert.deepEqual(store.state, before);
  assert.equal(fs.readFileSync(store.file, 'utf8'), disk);
  store.save = realSave;
  store.settings({ reducedMotion: true });
  assert.equal(new Store(root).state.settings.reducedMotion, true);
});
test('queued jobs progress independently without duplicate completion', () => {
  const root = folder(),
    store = new Store(root);
  for (const setupId of ['mojave', 'northern'])
    store.install({
      setupId,
      destination: path.join(root, setupId),
      desktopShortcut: false,
      steamShortcut: false,
    });
  store.tick();
  assert.equal(store.state.jobs[1].progress, 0);
  store.job('pause', store.state.jobs[0].id);
  for (let i = 0; i < 50; i++) store.tick();
  assert.deepEqual(
    store.state.installed.map((item) => item.setupId),
    ['northern'],
  );
  store.job('resume', store.state.jobs[0].id);
  for (let i = 0; i < 100; i++) store.tick();
  assert.equal(store.state.installed.length, 2);
  assert.equal(new Store(root).state.installed.length, 2);
});

test('existing schema-1 workspaces migrate without resetting their selected mode or user preferences', () => {
  const root = folder(),
    store = new Store(root);
  assert.equal(store.state.settings.onboardingComplete, false);
  const old = structuredClone(store.state);
  old.schemaVersion = 1;
  delete old.settings.onboardingComplete;
  old.settings.dummyData = false;
  old.settings.reducedMotion = true;
  fs.writeFileSync(store.file, JSON.stringify(old));
  const migrated = new Store(root);
  assert.equal(migrated.state.schemaVersion, 2);
  assert.equal(migrated.state.settings.onboardingComplete, true);
  assert.equal(migrated.state.settings.dummyData, false);
  assert.equal(migrated.state.settings.reducedMotion, true);
  assert.deepEqual(migrated.state.jobs, old.jobs);
  assert.deepEqual(migrated.state.installed, old.installed);
  assert.equal(new Store(root).state.settings.onboardingComplete, true);
  assert.throws(
    () => migrated.settings({ onboardingComplete: 'yes' }),
    /Invalid/,
  );
});

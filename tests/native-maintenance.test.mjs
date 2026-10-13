import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { libraryFixture } from './native-library-fixture.mjs';
const require = createRequire(import.meta.url);
const { NativeLibrary } = require('../electron/native-library.cjs');
const { NativeMaintenance } = require('../electron/native-maintenance.cjs');
async function fixture() {
  const f = await libraryFixture({
    extraFiles: [
      ['mods/Original/file.bin', 'immutable mod payload'],
      ['mods/Modified/file.bin', 'modifiable mod payload'],
      ['mods/Original/settings.ini', '[Settings]\nfixture=true\n'],
    ],
  });
  f.library = new NativeLibrary(f.state);
  f.id = (await f.library.prepare(async () => f.destination)).id;
  f.library.register(f.id);
  for (const [relative, contents] of [
    ['profiles/Test/saves/test.fos', 'synthetic ongoing save'],
    ['overwrite/generated.bin', 'user output'],
    ['downloads/cached.zip', 'user archive'],
    ['mods/Custom/user.bin', 'untracked mod'],
    ['Game/user.data', 'untracked game data'],
    ['mods/Modified/file.bin', 'changed user mod'],
  ]) {
    const target = path.join(f.destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  f.service = new NativeMaintenance(f.library, { idle: async () => {} });
  return f;
}
test('native removal deletes only reviewed unchanged recipe files and retains saves, settings, changed files and unrelated data', async () => {
  const f = await fixture();
  const plan = await f.service.preview(f.id);
  assert.equal(plan.files, 4);
  assert.ok(plan.preserved >= 10);
  assert.equal(fs.existsSync(plan.recovery), false);
  const before = new Map();
  function capture(folder) {
    for (const name of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, name.name);
      if (name.isDirectory()) capture(file);
      else
        before.set(path.relative(f.destination, file), fs.readFileSync(file));
    }
  }
  capture(f.destination);
  await f.service.remove(plan.id);
  assert.equal(f.library.record(f.id).status, 'removed');
  assert.equal(new NativeLibrary(f.state).record(f.id).status, 'removed');
  assert.equal(fs.existsSync(f.destination), false);
  const deleted = new Set([
    'ModOrganizer.exe',
    'portable.txt',
    'Game/FalloutNV.exe',
    'mods/Original/file.bin',
  ]);
  for (const [relative, data] of before) {
    const target = path.join(plan.recovery, relative);
    if (deleted.has(relative.replaceAll('\\', '/')))
      assert.equal(fs.existsSync(target), false);
    else assert.deepEqual(fs.readFileSync(target), data, relative);
  }
  assert.match(
    fs.readFileSync(path.join(f.owned, 'FalloutNV.exe'), 'utf8'),
    /^MZ synthetic/,
  );
  await assert.rejects(f.library.launch(f.id), /Only installed/);
  await assert.rejects(f.library.verify(f.id), /Only installed/);
  assert.throws(() => f.library.shortcutJob(f.id), /Only installed/);
});
test('files edited or replaced after review are preserved, including identical replacements with a new identity', async () => {
  const f = await fixture(),
    plan = await f.service.preview(f.id);
  fs.writeFileSync(
    path.join(f.destination, 'mods/Original/file.bin'),
    'edited after review',
  );
  const manager = path.join(f.destination, 'ModOrganizer.exe');
  const content = fs.readFileSync(manager);
  fs.renameSync(manager, path.join(f.destination, 'original-manager.retained'));
  fs.writeFileSync(manager, content);
  await f.service.remove(plan.id);
  assert.equal(
    fs.readFileSync(path.join(plan.recovery, 'mods/Original/file.bin'), 'utf8'),
    'edited after review',
  );
  assert.deepEqual(
    fs.readFileSync(path.join(plan.recovery, 'ModOrganizer.exe')),
    content,
  );
  assert.deepEqual(
    fs.readFileSync(path.join(plan.recovery, 'original-manager.retained')),
    content,
  );
});
test('interrupted native removal resumes from the durable recovery folder after restart', async () => {
  const f = await fixture();
  let calls = 0;
  const interrupted = new NativeMaintenance(f.library, {
    idle: async () => {},
    unlink: (file) => {
      if (++calls === 2)
        throw Object.assign(new Error('fixture locked file'), {
          code: 'EPERM',
        });
      fs.unlinkSync(file);
    },
  });
  const plan = await interrupted.preview(f.id);
  await assert.rejects(interrupted.remove(plan.id), /locked file/);
  assert.equal(f.library.record(f.id).status, 'removal-failed');
  assert.equal(fs.existsSync(f.destination), false);
  f.library.change(f.id, { status: 'removing', maintenanceError: null });
  const interruptedBytes = fs.readFileSync(f.library.file);
  const restarted = new NativeLibrary(f.state);
  assert.equal(restarted.record(f.id).status, 'removal-failed');
  assert.deepEqual(fs.readFileSync(f.library.file), interruptedBytes);
  const service = new NativeMaintenance(restarted, { idle: async () => {} });
  const retry = await service.preview(f.id);
  assert.equal(retry.files, 3);
  await service.remove(retry.id);
  assert.equal(restarted.record(f.id).status, 'removed');
  assert.equal(
    fs.readFileSync(
      path.join(plan.recovery, 'profiles/Test/saves/test.fos'),
      'utf8',
    ),
    'synthetic ongoing save',
  );
});
test('redirects, protected paths, conflicting recovery folders and changed receipts block native removal', async () => {
  const f = await fixture();
  const protectedService = new NativeMaintenance(f.library, {
    idle: async () => {},
    protectedRoots: () => [f.root],
  });
  await assert.rejects(protectedService.preview(f.id), /protected/);
  const outside = path.join(f.root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'canary'), 'preserved');
  const link = path.join(f.destination, 'untracked-link');
  fs.symlinkSync(outside, link, 'junction');
  await assert.rejects(f.service.preview(f.id), /redirected/);
  fs.unlinkSync(link);
  const plan = await f.service.preview(f.id);
  fs.mkdirSync(plan.recovery);
  await assert.rejects(f.service.remove(plan.id), /Both native candidate/);
  assert.equal(
    fs.readFileSync(path.join(outside, 'canary'), 'utf8'),
    'preserved',
  );
  assert.equal(
    fs.existsSync(path.join(f.destination, 'ModOrganizer.exe')),
    true,
  );
  fs.rmdirSync(plan.recovery);
  const changed = await f.service.preview(f.id);
  fs.writeFileSync(path.join(f.destination, '.loadstone-native.json'), '{}');
  await assert.rejects(
    f.service.remove(changed.id),
    /verified reconstruction receipt/,
  );
  assert.equal(fs.existsSync(f.destination), true);
  assert.equal(fs.existsSync(changed.recovery), false);
});
test('native removal journals before moving, cancels without losing retained data, and migrates schema 1 without eager writes', async () => {
  const f = await fixture(),
    plan = await f.service.preview(f.id);
  const persist = f.library.persist;
  f.library.persist = () => {
    throw new Error('fixture journal failure');
  };
  await assert.rejects(f.service.remove(plan.id), /journal failure/);
  f.library.persist = persist;
  assert.equal(fs.existsSync(f.destination), true);
  assert.equal(fs.existsSync(plan.recovery), false);
  const cancel = new NativeMaintenance(f.library, {
    idle: async () => {},
    unlink: (file) => {
      fs.unlinkSync(file);
      f.library.cancel();
    },
  });
  await assert.rejects(
    cancel.remove((await cancel.preview(f.id)).id),
    /stopped/,
  );
  assert.equal(f.library.record(f.id).status, 'removal-failed');
  assert.equal(
    fs.readFileSync(
      path.join(plan.recovery, 'profiles/Test/saves/test.fos'),
      'utf8',
    ),
    'synthetic ongoing save',
  );
  const fresh = await fixture();
  const state = JSON.parse(fs.readFileSync(fresh.library.file));
  state.schemaVersion = 1;
  for (const entry of state.entries)
    for (const key of [
      'status',
      'recoveryRoot',
      'maintenanceError',
      'shortcutsCleaned',
      'shortcutError',
      'repair',
    ])
      delete entry[key];
  const original = JSON.stringify(state);
  fs.writeFileSync(fresh.library.file, original);
  const migrated = new NativeLibrary(fresh.state);
  assert.equal(migrated.record(fresh.id).status, 'installed');
  assert.equal(fs.readFileSync(migrated.file, 'utf8'), original);
  await assert.rejects(migrated.verify(fresh.id), /Recipe file/);
  migrated.change(fresh.id, { maintenanceError: null });
  assert.equal(JSON.parse(fs.readFileSync(migrated.file)).schemaVersion, 3);
});

test('a directory redirected after removal review never permits deletion of an outside file', async () => {
  const f = await fixture(),
    plan = await f.service.preview(f.id);
  const game = path.resolve(f.destination, 'Game');
  const retained = path.resolve(f.destination, 'Game-retained');
  for (const target of [game, retained])
    assert.ok(target.startsWith(path.resolve(f.root) + path.sep));
  fs.renameSync(game, retained);
  const outside = path.join(f.root, 'outside-game');
  fs.mkdirSync(outside);
  const canary = fs.readFileSync(path.join(f.owned, 'FalloutNV.exe'));
  fs.writeFileSync(path.join(outside, 'FalloutNV.exe'), canary);
  fs.symlinkSync(outside, game, 'junction');
  await assert.rejects(f.service.remove(plan.id), /redirected/);
  assert.deepEqual(
    fs.readFileSync(path.join(outside, 'FalloutNV.exe')),
    canary,
  );
  assert.deepEqual(
    fs.readFileSync(path.join(plan.recovery, 'Game-retained/FalloutNV.exe')),
    canary,
  );
  assert.equal(f.library.record(f.id).status, 'removal-failed');
});

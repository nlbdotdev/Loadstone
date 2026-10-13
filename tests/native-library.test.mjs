import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { libraryFixture } from './native-library-fixture.mjs';
const require = createRequire(import.meta.url);
const {
  NativeLibrary,
  nativeLaunchPlan,
  verifyCandidate,
} = require('../electron/native-library.cjs');

test('native library verifies and persists a candidate, then launches only its declared isolated profile', async () => {
  const f = await libraryFixture();
  let child, invocation;
  const library = new NativeLibrary(f.state, {
    spawn: (file, args, options) => {
      invocation = { file, args, options };
      child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });
  const plan = await library.prepare(async () => f.destination);
  assert.equal(library.entries.length, 0);
  library.register(plan.id);
  assert.equal(new NativeLibrary(f.state).entries[0].id, plan.id);
  assert.equal(library.list().entries[0].launch, null);
  await library.launch(plan.id);
  assert.equal(invocation.file, path.join(f.destination, 'ModOrganizer.exe'));
  assert.deepEqual(invocation.args, ['-p', 'Test', 'run', '-e', 'New Vegas']);
  assert.equal(invocation.options.cwd, f.destination);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.env.NEXUS_API_KEY, undefined);
  await assert.rejects(library.launch(plan.id), /still open/);
  await assert.rejects(library.verify(plan.id), /Close the launched/);
  child.emit('exit', 0);
  await library.verify(plan.id);
  await assert.rejects(
    library.prepare(async () => f.destination),
    /already in/,
  );
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(f.destination, '.loadstone-native.json')),
    ).launchVerified,
    false,
  );
});

test('native checks reject redirected saves, changed executables and unsafe profile configuration without modifying them', async () => {
  const f = await libraryFixture();
  const library = new NativeLibrary(f.state);
  library.register((await library.prepare(async () => f.destination)).id);
  const record = library.entries[0];
  const settingsFile = path.join(f.destination, 'profiles/Test/settings.ini');
  const originalSettings = fs.readFileSync(settingsFile);
  fs.writeFileSync(
    settingsFile,
    '[General]\nLocalSaves=false\nLocalSettings=true\n',
  );
  assert.throws(() => nativeLaunchPlan(record), /LocalSaves/);
  fs.writeFileSync(settingsFile, originalSettings);
  fs.symlinkSync(
    f.owned,
    path.join(f.destination, 'profiles/Test/saves'),
    'junction',
  );
  assert.throws(() => nativeLaunchPlan(record), /redirected/);
  fs.unlinkSync(path.join(f.destination, 'profiles/Test/saves'));
  const iniFile = path.join(f.destination, 'ModOrganizer.ini'),
    originalIni = fs.readFileSync(iniFile, 'utf8');
  for (const edition of ['game_edition=GOG', '']) {
    fs.writeFileSync(iniFile, originalIni.replace(/game_edition=.*/, edition));
    assert.throws(() => nativeLaunchPlan(record), /game edition differs/);
  }
  // QSettings can rewrite quoted values; preserve semantic launch checks.
  fs.writeFileSync(
    iniFile,
    originalIni.replace('game_edition="Steam"', 'game_edition=Steam'),
  );
  assert.doesNotThrow(() => nativeLaunchPlan(record));
  fs.writeFileSync(
    iniFile,
    originalIni.replace(/mod_directory=.*/, `mod_directory=${f.owned}`),
  );
  assert.throws(() => nativeLaunchPlan(record), /inside this candidate/);
  fs.writeFileSync(
    iniFile,
    originalIni + '\n[Geometry]\nwindow_state=synthetic\n',
  );
  await library.verify(record.id); // Unrelated MO2 window state is mutable.
  fs.writeFileSync(
    iniFile,
    originalIni.replace(/1\\arguments=.*/, '1\\arguments=changed'),
  );
  assert.throws(() => nativeLaunchPlan(record), /arguments have changed/);
  fs.writeFileSync(iniFile, originalIni);
  for (const replacement of [
    originalIni.replace('[Settings]', '[Settings]\nMOD_DIRECTORY=outside'),
    originalIni + '\n [general]\ngamePath=outside\n',
    originalIni.replace('[General]', '[General]\ngame%50ath=outside'),
  ]) {
    fs.writeFileSync(iniFile, replacement);
    assert.throws(() => nativeLaunchPlan(record), /Duplicate|Encoded/);
  }
  fs.writeFileSync(iniFile, originalIni);
  const executable = path.join(f.destination, 'Game/FalloutNV.exe');
  const originalExe = fs.readFileSync(executable);
  fs.writeFileSync(
    executable,
    originalExe.map((v, i) => (i === 4 ? v ^ 1 : v)),
  );
  assert.throws(
    () => nativeLaunchPlan(record),
    /differs from the registered recipe/,
  );
  fs.writeFileSync(executable, originalExe);
  fs.appendFileSync(
    path.join(f.destination, 'profiles/Test/modlist.txt'),
    'changed',
  );
  await assert.rejects(library.verify(record.id));
  assert.match(
    fs.readFileSync(
      path.join(f.destination, 'profiles/Test/modlist.txt'),
      'utf8',
    ),
    /changed$/,
  );
});

test('native registration rejects failed receipts, replaced roots and changed reviewed metadata', async () => {
  const f = await libraryFixture(),
    library = new NativeLibrary(f.state);
  const receiptFile = path.join(f.destination, '.loadstone-native.json');
  const original = fs.readFileSync(receiptFile),
    receipt = JSON.parse(original);
  fs.writeFileSync(
    receiptFile,
    JSON.stringify({ ...receipt, status: 'failed' }),
  );
  await assert.rejects(
    library.prepare(async () => f.destination),
    /verified reconstruction receipt/,
  );
  fs.writeFileSync(receiptFile, original);
  const plan = await library.prepare(async () => f.destination);
  const recipeFile = path.join(f.destination, '.loadstone-recipe.json');
  const recipeOriginal = fs.readFileSync(recipeFile),
    recipe = JSON.parse(recipeOriginal);
  recipe.version = 'changed';
  fs.writeFileSync(recipeFile, JSON.stringify(recipe));
  assert.throws(() => library.register(plan.id), /recipe has changed/);
  assert.equal(fs.existsSync(library.file), false);
  fs.writeFileSync(recipeFile, recipeOriginal);
  // Rename only the explicit fixture candidate; preserve its files for inspection.
  fs.renameSync(f.destination, path.join(f.root, 'retained-candidate'));
  fs.mkdirSync(f.destination);
  assert.throws(() => library.register(plan.id), /replaced or redirected/);
});

test('cancelled verification and corrupt or externally changed registry never create or overwrite entries', async () => {
  const f = await libraryFixture();
  const controller = new AbortController();
  await assert.rejects(
    verifyCandidate(f.destination, {
      signal: controller.signal,
      progress: (p) => {
        if (p.completed === 2) controller.abort();
      },
    }),
    /aborted/i,
  );
  const library = new NativeLibrary(f.state);
  const plan = await library.prepare(async () => f.destination);
  fs.writeFileSync(library.file, 'unrecognized registry');
  assert.throws(() => library.register(plan.id));
  assert.equal(fs.readFileSync(library.file, 'utf8'), 'unrecognized registry');
  const corrupt = new NativeLibrary(f.state);
  assert.ok(corrupt.list().error);
  await assert.rejects(
    corrupt.prepare(async () => f.destination),
    /cannot be read/,
  );
  assert.throws(() => corrupt.launch(plan.id), /cannot be read/);
});

test('cancelled admission leaves no registry and a failed atomic replacement preserves the registered candidate', async () => {
  const f = await libraryFixture(),
    library = new NativeLibrary(f.state);
  const pending = library.prepare(async () => f.destination);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(library.busy, true);
  assert.throws(() => library.register('unused'), /Wait for native library/);
  library.cancel();
  await assert.rejects(pending, /cancelled/);
  assert.equal(library.busy, false);
  assert.equal(library.pending, null);
  assert.equal(fs.existsSync(library.file), false);
  library.register((await library.prepare(async () => f.destination)).id);
  const before = fs.readFileSync(library.file);
  const another = await libraryFixture();
  const plan = await library.prepare(async () => another.destination);
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === library.file)
      throw Object.assign(new Error('fixture replacement denied'), {
        code: 'EACCES',
      });
    return rename(from, to);
  };
  try {
    assert.throws(() => library.register(plan.id), /replacement denied/);
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(fs.readFileSync(library.file), before);
  assert.equal(library.entries.length, 1);
  assert.deepEqual(fs.readdirSync(f.state), ['native-library.json']);
  library.register(plan.id);
  assert.equal(new NativeLibrary(f.state).entries.length, 2);
});

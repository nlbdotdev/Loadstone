import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { libraryFixture } from './native-library-fixture.mjs';
import { storedRar5, fingerprint } from './native-archive-fixture.mjs';
import { packNativeRecipe } from '../scripts/native-package.mjs';
const require = createRequire(import.meta.url);
const {
  NativeLibrary,
  nativeLaunchPlan,
} = require('../electron/native-library.cjs');
const { NativeRepair } = require('../electron/native-repair.cjs');
const { NativeGuide } = require('../electron/native-guide.cjs');
const { materializeNative } = require('../electron/native-materializer.cjs');
const { createSevenZip } = require('../electron/sevenzip.cjs');

async function fixture() {
  const f = await libraryFixture({
    extraFiles: [
      ['mods/Test/asset.bin', 'original asset'],
      ['mods/Test/options.ini', '[Settings]\nvalue=original\n'],
    ],
  });
  f.library = new NativeLibrary(f.state);
  f.entryId = (await f.library.prepare(async () => f.destination)).id;
  f.library.register(f.entryId);
  f.makeRepair = (library = f.library, options = {}) =>
    new NativeRepair(library, f.entryId, { idle: async () => {}, ...options });
  f.prepare = (repair) =>
    repair.prepare(async () => ({
      packageFile: f.packageFile,
      recipeSha256: f.library.record(f.entryId).recipeSha256,
      inputs: { games: { fnv: f.owned }, archives: {} },
    }));
  f.file = (relative) => path.join(f.destination, relative);
  return f;
}

test('installed repair restores missing and changed recipe files, retains originals and preserves personal changes and saves', async () => {
  const f = await fixture();
  const receipt = fs.readFileSync(f.file('.loadstone-native.json'));
  const managerIdentity = fs.statSync(f.file('ModOrganizer.exe')).ino;
  fs.writeFileSync(f.file('mods/Test/asset.bin'), 'changed asset');
  fs.writeFileSync(
    f.file('mods/Test/options.ini'),
    '[Settings]\nvalue=personal\n',
  );
  fs.appendFileSync(
    f.file('profiles/Test/modlist.txt'),
    '\n# personal ordering',
  );
  fs.appendFileSync(
    f.file('ModOrganizer.ini'),
    '\n[Geometry]\nwindowWidth=1600\n',
  );
  fs.mkdirSync(f.file('profiles/Test/saves'));
  fs.writeFileSync(f.file('profiles/Test/saves/private.fos'), 'save canary');
  fs.writeFileSync(f.file('untracked.txt'), 'untracked canary');
  const game = f.recipe.outputs.find((v) =>
    v.path.endsWith('FalloutNV.exe'),
  ).path;
  fs.unlinkSync(f.file(game));
  const repair = f.makeRepair(),
    plan = await f.prepare(repair);
  assert.equal(plan.repair.conflicts, 1);
  assert.equal(plan.repair.missing, 1);
  assert.equal(plan.repair.preserved, 3);
  assert.equal(fs.existsSync(plan.repair.recoveryRoot), false);
  repair.start(plan.id);
  assert.equal(f.library.record(f.entryId).status, 'repairing');
  assert.throws(
    () => nativeLaunchPlan(f.library.record(f.entryId)),
    /Only installed/,
  );
  await repair.done;
  assert.equal(
    f.library.record(f.entryId).status,
    'installed',
    f.library.record(f.entryId).maintenanceError,
  );
  assert.equal(
    fs.readFileSync(f.file('mods/Test/asset.bin'), 'utf8'),
    'original asset',
  );
  assert.equal(
    fs.readFileSync(
      path.join(plan.repair.recoveryRoot, 'mods/Test/asset.bin'),
      'utf8',
    ),
    'changed asset',
  );
  assert.match(
    fs.readFileSync(f.file('mods/Test/options.ini'), 'utf8'),
    /personal/,
  );
  assert.match(
    fs.readFileSync(f.file('profiles/Test/modlist.txt'), 'utf8'),
    /personal ordering/,
  );
  assert.match(
    fs.readFileSync(f.file('ModOrganizer.ini'), 'utf8'),
    /windowWidth=1600/,
  );
  assert.equal(
    fs.readFileSync(f.file('profiles/Test/saves/private.fos'), 'utf8'),
    'save canary',
  );
  assert.equal(
    fs.readFileSync(f.file('untracked.txt'), 'utf8'),
    'untracked canary',
  );
  assert.equal(fs.statSync(f.file('ModOrganizer.exe')).ino, managerIdentity);
  assert.deepEqual(fs.readFileSync(f.file('.loadstone-native.json')), receipt);
  assert.equal(
    fs.readFileSync(path.join(f.owned, 'FalloutNV.exe'), 'utf8'),
    'MZ synthetic owned game; never execute',
  );
  nativeLaunchPlan(f.library.record(f.entryId)); // Validate only, never launch.
  const restarted = new NativeLibrary(f.state);
  assert.equal(restarted.record(f.entryId).repair.preserved, 3);
  assert.ok(restarted.record(f.entryId).repair.completedAt);
  await assert.rejects(restarted.verify(f.entryId), /Recipe file|too large/);
});

test('repair preserves unsafe local configuration and stays launch-disabled until an explicit configuration restore passes', async () => {
  const f = await fixture();
  const settings = f.file('profiles/Test/settings.ini');
  fs.writeFileSync(
    settings,
    '[General]\nLocalSaves=false\nLocalSettings=true\n',
  );
  let repair = f.makeRepair(),
    plan = await f.prepare(repair);
  repair.start(plan.id);
  await repair.done;
  assert.equal(f.library.record(f.entryId).status, 'repair-failed');
  assert.match(fs.readFileSync(settings, 'utf8'), /LocalSaves=false/);
  assert.throws(
    () => nativeLaunchPlan(f.library.record(f.entryId)),
    /Only installed/,
  );
  const library = new NativeLibrary(f.state);
  repair = f.makeRepair(library);
  repair.restoreConfiguration = true;
  plan = await f.prepare(repair);
  assert.equal(plan.repair.preserved, 0);
  assert.equal(plan.repair.conflicts, 1);
  repair.start(plan.id);
  await repair.done;
  assert.equal(library.record(f.entryId).status, 'installed');
  assert.match(
    fs.readFileSync(
      path.join(plan.repair.recoveryRoot, 'profiles/Test/settings.ini'),
      'utf8',
    ),
    /LocalSaves=false/,
  );
  nativeLaunchPlan(library.record(f.entryId));
});

test('repair refuses stale files, redirected paths, changed registry, incompatible recipes and active managers before mutation', async () => {
  const f = await fixture();
  let repair = f.makeRepair(),
    plan = await f.prepare(repair);
  fs.writeFileSync(f.file('mods/Test/asset.bin'), 'changed after review');
  assert.throws(() => repair.start(plan.id), /changed after/);
  assert.equal(f.library.record(f.entryId).status, 'installed');
  assert.equal(fs.existsSync(plan.repair.recoveryRoot), false);
  plan = await f.prepare(repair);
  fs.appendFileSync(f.library.file, ' ');
  assert.throws(() => repair.start(plan.id), /changed outside/);
  assert.equal(
    fs.readFileSync(f.file('mods/Test/asset.bin'), 'utf8'),
    'changed after review',
  );
  const library = new NativeLibrary(f.state);
  repair = f.makeRepair(library);
  const alias = f.file('redirected');
  fs.symlinkSync(f.owned, alias, 'junction');
  await assert.rejects(f.prepare(repair), /redirected/);
  fs.unlinkSync(alias);
  await assert.rejects(
    repair.prepare(async () => ({
      packageFile: f.packageFile,
      recipeSha256: '0'.repeat(64),
      inputs: { games: { fnv: f.owned }, archives: {} },
    })),
    /exact registered/,
  );
  library.launcher.sessions.set(f.entryId, { child: {} });
  await assert.rejects(f.prepare(repair), /Close the launched/);
});

test('repair keeps retained originals after a failed replacement, recovers interrupted state and retries the same installation', async () => {
  const f = await fixture();
  const asset = f.file('mods/Test/asset.bin');
  fs.writeFileSync(asset, 'original local change');
  let repair = f.makeRepair(),
    plan = await f.prepare(repair);
  const write = fs.createWriteStream;
  fs.createWriteStream = (file, ...args) => {
    if (file === asset) throw new Error('injected write failure');
    return write(file, ...args);
  };
  try {
    repair.start(plan.id);
    await repair.done;
  } finally {
    fs.createWriteStream = write;
  }
  assert.equal(f.library.record(f.entryId).status, 'repair-failed');
  const retained = path.join(plan.repair.recoveryRoot, 'mods/Test/asset.bin');
  assert.equal(fs.readFileSync(retained, 'utf8'), 'original local change');
  assert.equal(fs.existsSync(asset), false);
  // Model a process stopping before the durable repairing record was finalized.
  const state = JSON.parse(fs.readFileSync(f.library.file));
  state.entries[0].status = 'repairing';
  fs.writeFileSync(f.library.file, JSON.stringify(state));
  const library = new NativeLibrary(f.state);
  assert.equal(library.record(f.entryId).status, 'repair-failed');
  repair = f.makeRepair(library);
  plan = await f.prepare(repair);
  repair.start(plan.id);
  await repair.done;
  assert.equal(library.record(f.entryId).status, 'installed');
  assert.equal(fs.readFileSync(asset, 'utf8'), 'original asset');
  assert.equal(fs.readFileSync(retained, 'utf8'), 'original local change');
  assert.equal(library.entries.length, 1);
});

test('guided repair locks the installed target and invalidates review when configuration policy changes', async () => {
  const f = await fixture(),
    repair = f.makeRepair();
  const guide = new NativeGuide(repair, {
    repair: () => repair.context(),
    discover: async () => ({
      games: [{ id: 'fnv', source: 'steam', folder: f.owned }],
    }),
  });
  let view = await guide.import(async () => f.packageFile);
  assert.equal(view.repair.entryId, f.entryId);
  await assert.rejects(
    guide.select(view.id, 'parent', undefined, async () => f.root),
    /original destination/,
  );
  view = await guide.review(view.id);
  const id = view.plan.id;
  view = await guide.select(view.id, 'configuration', 'restore');
  assert.equal(view.repair.restoreConfiguration, true);
  assert.equal(view.plan, null);
  assert.throws(() => guide.start(view.id, id), /Review/);
});

test('repair cancellation retains the installation and schema-2 registrations migrate lazily without losing entries', async () => {
  const f = await fixture();
  const state = JSON.parse(fs.readFileSync(f.library.file));
  state.schemaVersion = 2;
  delete state.entries[0].repair;
  const before = JSON.stringify(state);
  fs.writeFileSync(f.library.file, before);
  const library = new NativeLibrary(f.state);
  assert.equal(library.record(f.entryId).repair, null);
  assert.equal(fs.readFileSync(f.library.file, 'utf8'), before);
  const repair = f.makeRepair(library),
    plan = await f.prepare(repair);
  repair.start(plan.id);
  library.cancel();
  await repair.done;
  assert.equal(library.record(f.entryId).status, 'repair-failed');
  assert.equal(JSON.parse(fs.readFileSync(library.file)).schemaVersion, 3);
  assert.equal(
    fs.readFileSync(f.file('mods/Test/asset.bin'), 'utf8'),
    'original asset',
  );
  const restarted = new NativeLibrary(f.state),
    retry = f.makeRepair(restarted);
  const next = await f.prepare(retry);
  retry.start(next.id);
  await retry.done;
  assert.equal(restarted.record(f.entryId).status, 'installed');
  assert.equal(restarted.entries.length, 1);
});

test('cancelling after a replacement and failing final state persistence both leave a durable launch-disabled recovery', async () => {
  const f = await fixture(),
    asset = f.file('mods/Test/asset.bin');
  fs.writeFileSync(asset, 'retain this change');
  let repair = f.makeRepair(),
    plan = await f.prepare(repair);
  const create = fs.createWriteStream;
  fs.createWriteStream = (file, ...args) => {
    const stream = create(file, ...args);
    if (file === asset) stream.once('finish', () => f.library.cancel());
    return stream;
  };
  try {
    repair.start(plan.id);
    await repair.done;
  } finally {
    fs.createWriteStream = create;
  }
  assert.equal(f.library.record(f.entryId).status, 'repair-failed');
  assert.equal(
    fs.readFileSync(
      path.join(plan.repair.recoveryRoot, 'mods/Test/asset.bin'),
      'utf8',
    ),
    'retain this change',
  );
  const library = new NativeLibrary(f.state);
  repair = f.makeRepair(library);
  plan = await f.prepare(repair);
  const persist = library.persist.bind(library);
  let changes = 0;
  library.persist = (entries) => {
    if (++changes > 1) throw new Error('injected persistence failure');
    persist(entries);
  };
  repair.start(plan.id);
  await repair.done;
  assert.match(library.error, /could not be saved/);
  assert.equal(
    JSON.parse(fs.readFileSync(library.file)).entries[0].status,
    'repairing',
  );
  const restarted = new NativeLibrary(f.state);
  assert.equal(restarted.record(f.entryId).status, 'repair-failed');
  const retry = f.makeRepair(restarted),
    finalPlan = await f.prepare(retry);
  retry.start(finalPlan.id);
  await retry.done;
  assert.equal(restarted.record(f.entryId).status, 'installed');
});

test(
  'installed repair reacquires original RAR bytes through the shared cache and verifies repaired outputs',
  { skip: !process.env.LOADSTONE_TEST_7ZIP },
  async () => {
    const f = await libraryFixture({
      extraFiles: [['mods/Test/archive.bin', 'archive fixture']],
    });
    const data = Buffer.from('archive fixture'),
      archiveBytes = storedRar5(new Map([['Data/member.bin', data]]));
    const archive = path.join(f.root, 'packages/original.rar');
    fs.writeFileSync(archive, archiveBytes);
    f.recipe.sources.push({
      id: 'repair-archive',
      type: 'https-archive',
      url: 'https://example.org/original.rar',
      ...fingerprint(archiveBytes),
      credit: {
        name: 'Original synthetic fixture',
        url: 'https://example.org/credit',
      },
    });
    f.recipe.outputs.find((v) => v.path === 'mods/Test/archive.bin').action = {
      type: 'extract',
      source: 'repair-archive',
      member: 'Data/member.bin',
    };
    f.recipe.sources = f.recipe.sources.filter((source) =>
      f.recipe.outputs.some((output) => output.action.source === source.id),
    );
    const packageFile = path.join(f.root, 'packages/archived.loadstone'),
      destination = path.join(f.root, 'archived');
    await packNativeRecipe(f.recipe, f.payloads, packageFile);
    const sevenZip = await createSevenZip(process.env.LOADSTONE_TEST_7ZIP);
    await materializeNative(packageFile, destination, {
      games: { fnv: f.owned },
      archives: { 'repair-archive': archive },
      sevenZip,
    });
    const library = new NativeLibrary(f.state),
      id = (await library.prepare(async () => destination)).id;
    library.register(id);
    fs.writeFileSync(
      path.join(destination, 'mods/Test/archive.bin'),
      'damaged archive output',
    );
    let requests = 0;
    const repair = new NativeRepair(library, id, {
      idle: async () => {},
      downloadRequest: async () => {
        requests++;
        const stream = Readable.from([archiveBytes]);
        stream.statusCode = 200;
        stream.headers = {};
        return stream;
      },
    });
    const plan = await repair.prepare(
      async () => ({
        packageFile,
        recipeSha256: library.record(id).recipeSha256,
        inputs: {
          games: { fnv: f.owned },
          archives: { 'repair-archive': null },
        },
      }),
      async () => process.env.LOADSTONE_TEST_7ZIP,
    );
    repair.start(plan.id);
    await repair.done;
    assert.equal(library.record(id).status, 'installed');
    assert.equal(requests, 1);
    assert.equal(
      fs.readFileSync(path.join(destination, 'mods/Test/archive.bin'), 'utf8'),
      'archive fixture',
    );
    assert.equal(
      fs.readFileSync(
        path.join(plan.repair.recoveryRoot, 'mods/Test/archive.bin'),
        'utf8',
      ),
      'damaged archive output',
    );
  },
);

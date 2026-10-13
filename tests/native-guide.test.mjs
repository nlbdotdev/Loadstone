import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { createNativeFixture } from './native-fixture.mjs';
import { createArchiveFixture } from './native-archive-fixture.mjs';
import { packNativeRecipe } from '../scripts/native-package.mjs';
const require = createRequire(import.meta.url);
const { NativeBuilder } = require('../electron/native-builder.cjs');
const { NativeGuide } = require('../electron/native-guide.cjs');

async function fixture() {
  const f = createNativeFixture({ prerequisite: true, mo2Config: true });
  f.game = path.join(f.root, 'game');
  f.local = path.join(f.root, 'prerequisite');
  f.parent = path.join(f.root, 'setups');
  f.packages = path.join(f.root, 'packages');
  for (const dir of [f.game, f.local, f.parent, f.packages]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(f.game, 'FalloutNV.exe'), 'fixture owned game');
  fs.writeFileSync(
    path.join(f.local, 'support.bin'),
    'user-provided prerequisite bytes',
  );
  f.packageFile = path.join(f.packages, 'fixture.loadstone');
  await packNativeRecipe(f.recipe, f.payloads, f.packageFile);
  f.builder = new NativeBuilder(path.join(f.root, 'state'), {
    idle: async () => {},
  });
  f.options = {
    discover: async () => ({
      games: [{ id: 'fnv', source: 'steam', folder: f.game }],
    }),
    defaultParent: () => f.parent,
  };
  f.guide = new NativeGuide(f.builder, f.options);
  return f;
}
test('guided native install selects games and prerequisites without input JSON, binds review and completes the shared builder', async () => {
  const f = await fixture();
  let view = await f.guide.import(async () => f.packageFile);
  assert.equal(view.games[0].folder, f.game);
  assert.equal(view.ready, false);
  assert.deepEqual(fs.readdirSync(f.parent), []);
  assert.equal('inputs' in view, false);
  assert.equal('packageFile' in view, false);
  await assert.rejects(f.guide.review(view.id), /Select each required/);
  view = await f.guide.select(
    view.id,
    'prerequisite',
    'prepared-support',
    async () => f.local,
  );
  assert.equal(view.ready, true);
  view = await f.guide.review(view.id);
  const firstPlan = view.plan.id;
  assert.equal(await f.guide.import(async () => null), null);
  assert.equal(f.guide.state().id, view.id);
  assert.equal(f.guide.state().prerequisites[0].folder, f.local);
  assert.equal(f.guide.state().plan, null);
  assert.throws(() => f.guide.start(view.id, firstPlan), /Review/);
  await f.guide.select(view.id, 'parent', undefined, async () => f.parent);
  assert.throws(() => f.guide.start(view.id, firstPlan), /Review/);
  view = await f.guide.review(view.id);
  f.guide.start(view.id, view.plan.id);
  await f.builder.done;
  assert.equal(f.builder.list()[0].status, 'verified');
  const destination = f.builder.list()[0].destination;
  assert.equal(
    fs.readFileSync(path.join(destination, 'mods/Support/support.bin'), 'utf8'),
    'user-provided prerequisite bytes',
  );
  assert.equal(
    fs.readFileSync(path.join(f.game, 'FalloutNV.exe'), 'utf8'),
    'fixture owned game',
  );
  const persisted = fs.readFileSync(f.builder.file, 'utf8');
  assert.equal(
    persisted.includes(f.packageFile.replaceAll('\\', '\\\\')),
    false,
  );
  assert.equal(persisted.includes('prerequisites'), false);
  assert.deepEqual(fs.readdirSync(f.packages), ['fixture.loadstone']);
  assert.throws(() => f.guide.start(view.id, view.plan.id), /Review/);
});

test('guide rejects undeclared inputs, stale tokens, redirects, recipe replacement and overlapping selections', async () => {
  const f = await fixture();
  let view = await f.guide.import(async () => f.packageFile);
  let called = false;
  await assert.rejects(
    f.guide.select(view.id, 'game', 'fallout4', async () => {
      called = true;
      return f.game;
    }),
    /not declared/,
  );
  assert.equal(called, false);
  await assert.rejects(
    f.guide.select(view.id, 'game', 'fnv', null, 'stale-token'),
    /detected/,
  );
  await assert.rejects(
    f.guide.select(view.id, 'shell', 'fnv', async () => f.game),
    /Unsupported/,
  );
  const redirected = path.join(f.root, 'alias');
  fs.symlinkSync(f.local, redirected, 'junction');
  await assert.rejects(
    f.guide.select(
      view.id,
      'prerequisite',
      'prepared-support',
      async () => redirected,
    ),
    /redirected/,
  );
  view = await f.guide.select(
    view.id,
    'prerequisite',
    'prepared-support',
    async () => f.local,
  );
  let release;
  const pending = f.guide.select(
    view.id,
    'parent',
    undefined,
    () => new Promise((resolve) => (release = resolve)),
  );
  await assert.rejects(
    f.builder.prepare(async () => null),
    /Wait/,
  );
  await assert.rejects(
    f.guide.import(async () => f.packageFile),
    /Wait/,
  );
  release(null);
  await pending;
  f.recipe.version = 'changed';
  const replaced = path.join(f.packages, 'replacement.loadstone');
  await packNativeRecipe(f.recipe, f.payloads, replaced);
  fs.copyFileSync(replaced, f.packageFile);
  await assert.rejects(f.guide.review(view.id), /changed after import/);
  assert.equal(f.builder.list().length, 0);
  assert.deepEqual(fs.readdirSync(f.parent), []);
});

test('ambiguous or wrong-store detected games require an explicit matching selection', async () => {
  const f = await fixture();
  f.guide.options.discover = async () => ({
    games: [
      { id: 'fnv', source: 'steam', folder: f.game },
      { id: 'fnv', source: 'steam', folder: f.local },
      { id: 'fnv', source: 'gog', folder: f.parent },
    ],
  });
  let view = await f.guide.import(async () => f.packageFile);
  assert.equal(view.games[0].folder, null);
  assert.equal(view.games[0].detected.length, 2);
  const token = view.games[0].detected[0].token;
  view = await f.guide.select(view.id, 'game', 'fnv', null, token);
  assert.equal(view.games[0].folder, f.game);
  const oldId = view.id;
  view = await f.guide.import(async () => f.packageFile);
  await assert.rejects(
    f.guide.select(oldId, 'game', 'fnv', null, token),
    /Import/,
  );
  await assert.rejects(
    f.guide.select(view.id, 'game', 'fnv', null, token),
    /detected/,
  );
});

test('guided resume reselects inputs after restart and keeps the original destination and record', async () => {
  const f = await fixture();
  let view = await f.guide.import(async () => f.packageFile);
  view = await f.guide.select(
    view.id,
    'prerequisite',
    'prepared-support',
    async () => f.local,
  );
  view = await f.guide.review(view.id);
  const change = f.builder.change.bind(f.builder);
  f.builder.change = (id, patch, persist) => {
    change(id, patch, persist);
    if (patch.completed === 1 && !patch.status) f.builder.cancel(id);
  };
  const jobId = view.plan.id;
  f.guide.start(view.id, jobId);
  await f.builder.done;
  assert.equal(f.builder.list()[0].status, 'cancelled');
  const next = new NativeBuilder(f.builder.root, { idle: async () => {} }),
    guide = new NativeGuide(next, f.options);
  assert.equal(guide.state(), null);
  view = await guide.import(async () => f.packageFile, jobId);
  assert.equal(view.resumeId, jobId);
  await assert.rejects(
    guide.select(view.id, 'parent', null, async () => f.local),
    /original destination/,
  );
  view = await guide.select(
    view.id,
    'prerequisite',
    'prepared-support',
    async () => f.local,
  );
  view = await guide.review(view.id);
  assert.equal(view.plan.resume.reused, 1);
  guide.start(view.id, view.plan.id);
  await next.done;
  assert.equal(next.list().length, 1);
  assert.equal(next.list()[0].id, jobId);
  assert.equal(next.list()[0].status, 'verified');
});

test(
  'guided archive choices use verified local files or original downloads through the shared acquisition path',
  { skip: !process.env.LOADSTONE_TEST_7ZIP, timeout: 60000 },
  async () => {
    const f = await createArchiveFixture('rar5');
    fs.unlinkSync(f.inputsFile);
    let requests = 0;
    const builder = new NativeBuilder(f.state, {
      downloadRequest: async () => {
        requests++;
        const stream = Readable.from([fs.readFileSync(f.archive)]);
        stream.statusCode = 200;
        stream.headers = {};
        return stream;
      },
    });
    const guide = new NativeGuide(builder, {
      discover: async () => ({
        games: [{ id: 'fnv', source: 'steam', folder: f.game }],
      }),
      defaultParent: () => f.parent,
    });
    let view = await guide.import(async () => f.packageFile);
    assert.equal(view.archives[0].file, null);
    assert.equal(requests, 0);
    view = await guide.select(
      view.id,
      'archive',
      'original-archive',
      async () => f.archive,
    );
    assert.equal(view.archives[0].file, f.archive);
    view = await guide.review(
      view.id,
      async () => process.env.LOADSTONE_TEST_7ZIP,
    );
    assert.equal(view.plan.downloadCount, 0);
    guide.start(view.id, view.plan.id);
    await builder.done;
    assert.equal(builder.list()[0].status, 'verified');
    assert.equal(requests, 0);
    view = await guide.select(view.id, 'download', 'original-archive');
    view = await guide.review(
      view.id,
      async () => process.env.LOADSTONE_TEST_7ZIP,
    );
    assert.equal(view.plan.downloadCount, 1);
    guide.start(view.id, view.plan.id);
    await builder.done;
    assert.equal(builder.list()[1].status, 'verified');
    assert.equal(requests, 1);
    assert.equal(fs.existsSync(f.inputsFile), false);
  },
);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { libraryFixture } from './native-library-fixture.mjs';
import { packNativeRecipe } from '../scripts/native-package.mjs';
const require = createRequire(import.meta.url);
const { NativeLibrary } = require('../electron/native-library.cjs');
const { NativeBuilder } = require('../electron/native-builder.cjs');
const { NativeGuide } = require('../electron/native-guide.cjs');
const { NativeUpdate } = require('../electron/native-update.cjs');

function tree(root) {
  return fs
    .readdirSync(root, { recursive: true })
    .sort()
    .map((relative) => {
      const file = path.join(root, relative),
        stat = fs.lstatSync(file);
      return [
        relative,
        stat.ino,
        stat.isFile() ? fs.readFileSync(file).toString('base64') : null,
      ];
    });
}
async function fixture() {
  const f = await libraryFixture({
    extraFiles: [['mods/Test/settings.ini', 'recipe configuration']],
  });
  f.library = new NativeLibrary(f.state);
  f.entryId = (await f.library.prepare(async () => f.destination)).id;
  f.library.register(f.entryId);
  fs.writeFileSync(
    path.join(f.destination, 'mods/Test/settings.ini'),
    'personal configuration',
  );
  fs.mkdirSync(path.join(f.destination, 'profiles/Test/saves'));
  fs.writeFileSync(
    path.join(f.destination, 'profiles/Test/saves/canary.fos'),
    'existing playthrough',
  );
  f.before = tree(f.destination);
  f.original = structuredClone(f.library.entries[0]);
  f.next = structuredClone(f.recipe);
  f.next.version = '2.0.0';
  f.next.saveCompatibility = {
    status: 'new-save-required',
    notes: 'Start a fresh playthrough for version 2.',
  };
  f.nextFile = path.join(f.root, 'packages', 'next.loadstone');
  await packNativeRecipe(f.next, f.payloads, f.nextFile);
  f.builderOptions = {
    idle: async () => {},
    protectedRoots: () => f.library.entries.map((v) => v.root),
  };
  f.builder = new NativeBuilder(f.state, f.builderOptions);
  f.update = new NativeUpdate(f.library, f.entryId);
  f.options = {
    discover: async () => ({
      games: [{ id: 'fnv', source: 'steam', folder: f.owned }],
    }),
    update: (...args) => f.update.review(...args),
  };
  f.guide = new NativeGuide(f.builder, f.options);
  return f;
}

test('native version update builds and admits a separate candidate while retaining the entire original playthrough', async () => {
  const f = await fixture();
  let view = await f.guide.import(async () => f.nextFile);
  assert.deepEqual(view.update, {
    entryId: f.entryId,
    name: f.original.name,
    version: f.original.version,
    root: f.destination,
  });
  assert.equal(view.saveCompatibility.status, 'new-save-required');
  view = await f.guide.review(view.id);
  assert.notEqual(view.plan.destination, f.destination);
  assert.equal(fs.existsSync(view.plan.destination), false);
  f.guide.start(view.id, view.plan.id);
  await f.builder.done;
  assert.equal(f.builder.jobs[0].status, 'verified');
  const destination = f.builder.jobs[0].destination;
  assert.equal(
    fs.readFileSync(path.join(destination, 'mods/Test/settings.ini'), 'utf8'),
    'recipe configuration',
  );
  assert.equal(
    fs.existsSync(path.join(destination, 'profiles/Test/saves/canary.fos')),
    false,
  );
  const plan = await f.library.prepare(async () => destination);
  f.library.register(plan.id);
  assert.equal(f.library.entries.length, 2);
  assert.deepEqual(f.library.entries[0], f.original);
  assert.deepEqual(tree(f.destination), f.before);
  const restarted = new NativeLibrary(f.state);
  assert.equal(restarted.entries[1].version, '2.0.0');
  assert.equal(restarted.entries[1].saveStatus, 'new-save-required');
  assert.deepEqual(restarted.entries[0], f.original);
  assert.notEqual(restarted.entries[0].id, restarted.entries[1].id);
});

test('update selection rejects unrelated recipes, unchanged versions, unavailable entries and changed original metadata', async () => {
  const f = await fixture();
  for (const next of [
    { ...f.next, id: 'unrelated-setup' },
    { ...f.next, game: { id: 'fallout4', variant: 'base' } },
    { ...f.next, game: { id: 'fnv', variant: 'ttw' } },
  ])
    assert.throws(() => f.update.review(next), /same setup ID/);
  await assert.rejects(
    f.guide.import(async () => f.packageFile),
    /installed version/,
  );
  const view = await f.guide.import(async () => f.nextFile);
  f.library.launcher.sessions.set(f.entryId, { child: {} });
  await assert.rejects(f.guide.review(view.id), /Close the launched/);
  f.library.launcher.sessions.clear();
  f.library.entries[0].status = 'repair-failed';
  assert.throws(() => f.update.review(f.next, view.update), /installed native/);
  f.library.entries[0].status = 'installed';
  fs.writeFileSync(
    path.join(f.destination, '.loadstone-recipe.json'),
    JSON.stringify(f.next),
  );
  await assert.rejects(
    f.guide.review(view.id),
    /registered recipe has changed/,
  );
  assert.equal(f.builder.jobs.length, 0);
});

test('update review and confirmation reject stale registry state, original root replacement and overlapping destinations', async () => {
  const f = await fixture();
  let view = await f.guide.import(async () => f.nextFile);
  view = await f.guide.select(
    view.id,
    'parent',
    null,
    async () => f.destination,
  );
  await assert.rejects(f.guide.review(view.id), /separate folder/);
  assert.equal(f.builder.plan, null);
  assert.equal(f.guide.state().plan, null);
  assert.deepEqual(tree(f.destination), f.before);
  view = await f.guide.select(view.id, 'parent', null, async () => f.root);
  view = await f.guide.review(view.id);
  const state = fs.readFileSync(f.library.file);
  fs.appendFileSync(f.library.file, ' ');
  assert.throws(() => f.guide.start(view.id, view.plan.id), /changed outside/);
  assert.equal(fs.existsSync(view.plan.destination), false);
  fs.writeFileSync(f.library.file, state);
  f.library.change(f.entryId, { verifiedAt: '2030-01-01T00:00:00.000Z' });
  assert.throws(
    () => f.guide.start(view.id, view.plan.id),
    /original setup changed/,
  );
  view = await f.guide.import(async () => f.nextFile);
  const link = path.join(f.root, 'redirected');
  fs.symlinkSync(f.destination, link, 'junction');
  await assert.rejects(
    f.guide.select(view.id, 'parent', null, async () => link),
    /redirected/,
  );
  // A registration whose path was replaced cannot be used as update provenance.
  const replacement = path.join(f.root, 'replacement');
  fs.mkdirSync(replacement);
  const savedRoot = f.library.entries[0].root;
  f.library.entries[0].root = replacement;
  await assert.rejects(f.guide.review(view.id), /replaced or redirected/);
  f.library.entries[0].root = savedRoot;
  assert.equal(f.builder.jobs.length, 0);
});

test('cancelled updates resume as independent builds after restart without changing original files or registration', async () => {
  const f = await fixture();
  let view = await f.guide.import(async () => f.nextFile);
  view = await f.guide.review(view.id);
  const change = f.builder.change.bind(f.builder);
  f.builder.change = (id, patch, persist) => {
    change(id, patch, persist);
    if (patch.completed === 1 && !patch.status) f.builder.cancel(id);
  };
  f.guide.start(view.id, view.plan.id);
  await f.builder.done;
  assert.equal(f.builder.jobs[0].status, 'cancelled');
  const initial = f.builder.jobs[0];
  const builder = new NativeBuilder(f.state, f.builderOptions);
  const guide = new NativeGuide(builder, { discover: f.options.discover });
  view = await guide.import(async () => f.nextFile, initial.id);
  assert.equal(view.update, null);
  view = await guide.review(view.id);
  guide.start(view.id, view.plan.id);
  await builder.done;
  assert.equal(builder.jobs.length, 1);
  assert.equal(builder.jobs[0].destination, initial.destination);
  assert.equal(builder.jobs[0].status, 'verified');
  assert.deepEqual(tree(f.destination), f.before);
  assert.deepEqual(f.library.entries, [f.original]);
});

test('failed new-version source verification preserves the old setup and allows a reviewed retry', async () => {
  const f = await fixture();
  let view = await f.guide.import(async () => f.nextFile);
  view = await f.guide.review(view.id);
  const input = path.join(f.owned, 'FalloutNV.exe');
  const original = fs.readFileSync(input);
  fs.writeFileSync(input, 'wrong source bytes');
  f.guide.start(view.id, view.plan.id);
  await f.builder.done;
  assert.equal(f.builder.jobs[0].status, 'failed');
  assert.deepEqual(tree(f.destination), f.before);
  assert.deepEqual(f.library.entries, [f.original]);
  fs.writeFileSync(input, original);
  const guide = new NativeGuide(f.builder, { discover: f.options.discover });
  view = await guide.import(async () => f.nextFile, f.builder.jobs[0].id);
  view = await guide.review(view.id);
  guide.start(view.id, view.plan.id);
  await f.builder.done;
  assert.equal(f.builder.jobs[0].status, 'verified');
  assert.deepEqual(tree(f.destination), f.before);
});

test('save guidance stays a creator declaration and selecting a different version does not infer version ordering', async () => {
  const f = await fixture();
  for (const status of ['compatible', 'unknown', 'new-save-required']) {
    const next = {
      ...f.next,
      version: 'older-label',
      saveCompatibility: { status, notes: `Creator guidance: ${status}` },
    };
    const file = path.join(f.root, 'packages', `${status}.loadstone`);
    await packNativeRecipe(next, f.payloads, file);
    const view = await f.guide.import(async () => file);
    assert.deepEqual(view.saveCompatibility, next.saveCompatibility);
    assert.equal(view.version, 'older-label');
  }
  assert.deepEqual(tree(f.destination), f.before);
  assert.equal(f.builder.jobs.length, 0);
});

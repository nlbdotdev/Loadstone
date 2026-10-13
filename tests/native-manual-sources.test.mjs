import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { manualFixture } from './native-manual-fixture.mjs';
const require = createRequire(import.meta.url);
const { NativeBuilder } = require('../electron/native-builder.cjs');
const { NativeGuide } = require('../electron/native-guide.cjs');
const {
  nexusFilePage,
  verifyLocalArchive,
} = require('../electron/native-manual-sources.cjs');

async function setup() {
  const f = await manualFixture();
  f.requests = 0;
  f.builder = new NativeBuilder(f.state, {
    downloadRequest: async () => {
      f.requests++;
      throw new Error('No automatic request expected');
    },
  });
  f.guide = new NativeGuide(f.builder, f.options);
  f.view = await f.guide.import(async () => f.packageFile);
  return f;
}

test('manual Nexus selection blocks review until exact original bytes pass, then reconstructs without an account or network', async () => {
  const f = await setup();
  assert.equal(f.view.manualNexus, true);
  assert.equal(f.view.ready, false);
  await assert.rejects(f.guide.review(f.view.id), /every Nexus archive/);
  const opened = [];
  let view = await f.guide.openSource(f.view.id, f.source.id, async (url) =>
    opened.push(url),
  );
  assert.deepEqual(opened, [
    'https://www.nexusmods.com/falloutnv/mods/123?tab=files&file_id=456',
  ]);
  assert.equal(view.ready, false);
  assert.equal(f.requests, 0);
  assert.deepEqual(fs.readdirSync(f.parent), []);
  view = await f.guide.select(
    view.id,
    'archive',
    f.source.id,
    async () => f.archive,
  );
  assert.equal(view.archives[0].verified, true);
  assert.equal(view.ready, true);
  view = await f.guide.review(view.id);
  assert.equal(view.plan.downloadCount, 0);
  assert.equal(view.plan.archiveTool, null);
  f.guide.start(view.id, view.plan.id);
  await f.builder.done;
  assert.equal(f.builder.jobs[0].status, 'verified');
  assert.equal(f.requests, 0);
  assert.equal(
    fs.statSync(
      path.join(f.builder.jobs[0].destination, 'mods/Example/example.esp'),
    ).size,
    2_000_000,
  );
  const persisted = fs.readFileSync(f.builder.file, 'utf8');
  assert.equal(persisted.includes('nexusmods.com'), false);
  assert.equal(persisted.includes('manualNexus'), false);
  const restarted = new NativeGuide(new NativeBuilder(f.state), f.options);
  assert.equal(restarted.state(), null);
});

test('manual archive mismatch, cancellation and redirects retain prior selection and invalidate review', async () => {
  const f = await setup();
  let view = await f.guide.select(
    f.view.id,
    'archive',
    f.source.id,
    async () => f.archive,
  );
  view = await f.guide.review(view.id);
  const reviewedId = view.plan.id;
  const wrong = path.join(f.root, 'wrong.zip');
  fs.writeFileSync(wrong, Buffer.alloc(f.source.bytes, 9));
  await assert.rejects(
    f.guide.select(view.id, 'archive', f.source.id, async () => wrong),
    /SHA-256/,
  );
  assert.equal(f.guide.state().plan, null);
  assert.equal(f.guide.state().archives[0].file, f.archive);
  assert.equal(f.guide.state().archives[0].verified, true);
  assert.throws(() => f.guide.start(view.id, reviewedId), /Review/);
  const alias = path.join(f.root, 'alias');
  fs.symlinkSync(f.packages, alias, 'junction');
  await assert.rejects(
    f.guide.select(view.id, 'archive', f.source.id, async () =>
      path.join(alias, 'original.zip'),
    ),
    /SHA-256/,
  );
  assert.equal(f.guide.state().archives[0].file, f.archive);
  view = await f.guide.select(
    view.id,
    'archive',
    f.source.id,
    async () => null,
  );
  assert.equal(view.archives[0].file, f.archive);
  const originalRead = fs.createReadStream;
  try {
    fs.createReadStream = (...args) => {
      const stream = originalRead(...args);
      stream.once('data', () => f.guide.cancelSelection(view.id));
      return stream;
    };
    await assert.rejects(
      f.guide.select(view.id, 'archive', f.source.id, async () => f.archive),
      /cancelled/,
    );
  } finally {
    fs.createReadStream = originalRead;
  }
  assert.equal(f.builder.busy, false);
  assert.equal(f.guide.state().selectionActivity, null);
  assert.equal(f.guide.state().archives[0].file, f.archive);
  assert.equal(fs.statSync(wrong).size, f.source.bytes);
});

test('only declared Nexus sources may open; invalid IDs, URL substitutions and concurrent work cannot open a browser', async () => {
  const f = await setup();
  let calls = 0;
  const open = async () => {
    calls++;
  };
  await assert.rejects(
    f.guide.openSource('stale', f.source.id, open),
    /Import/,
  );
  for (const key of [
    'https://example.org/',
    'file:///C:/Windows/test.exe',
    'missing',
    f.recipe.sources[0].id,
  ])
    await assert.rejects(
      f.guide.openSource(f.view.id, key, open),
      /declared Nexus/,
    );
  for (const bad of [
    { ...f.source, game: 'falloutnv/../../other' },
    { ...f.source, type: 'https-archive', url: 'https://example.org/' },
    { ...f.source, modId: '123&other=1' },
    { ...f.source, fileId: -1 },
  ])
    assert.throws(() => nexusFilePage(bad), /declared Nexus/);
  assert.equal(calls, 0);
  let release;
  const pending = f.guide.openSource(
    f.view.id,
    f.source.id,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await assert.rejects(
    f.guide.openSource(f.view.id, f.source.id, open),
    /Wait/,
  );
  await assert.rejects(
    f.guide.select(f.view.id, 'archive', f.source.id, async () => f.archive),
    /Wait/,
  );
  release();
  await pending;
  await assert.rejects(
    f.guide.openSource(f.view.id, f.source.id, async () => {
      throw new Error('private external error');
    }),
    /Could not open/,
  );
  assert.equal(f.builder.busy, false);
  assert.equal(calls, 0);
});

test('verified cache selection is read-only and explicit, and mode changes keep Premium requirements in acquisition', async () => {
  const f = await setup();
  await assert.rejects(
    f.guide.select(f.view.id, 'cached-archive', f.source.id),
    /not found/,
  );
  const cached = path.join(f.cache, `${f.source.sha256}.archive`);
  fs.copyFileSync(f.archive, cached);
  const before = fs.statSync(cached).ino;
  let view = await f.guide.select(f.view.id, 'cached-archive', f.source.id);
  assert.equal(view.archives[0].file, cached);
  assert.equal(view.archives[0].verified, true);
  view = await f.guide.review(view.id);
  assert.equal(view.plan.downloadCount, 0);
  view = await f.guide.select(view.id, 'download', f.source.id);
  assert.equal(view.plan, null);
  assert.equal(view.ready, false);
  assert.equal(view.archives[0].verified, false);
  view = await f.guide.select(view.id, 'nexus-mode', 'automatic');
  assert.equal(view.ready, true);
  assert.equal(f.requests, 0);
  assert.equal(fs.statSync(cached).ino, before);
  // A saved Premium status only selects a default. Download authorization stays
  // in acquireArchives, which always freshly verifies uncached Nexus requests.
  const premium = new NativeGuide(f.builder, {
    ...f.options,
    premium: () => true,
  });
  const automatic = await premium.import(async () => f.packageFile);
  assert.equal(automatic.manualNexus, false);
  assert.equal(automatic.ready, true);
});

test('archive verification is bounded, reports byte progress, rejects mid-read mutation and installation rechecks selected bytes', async () => {
  const f = await setup();
  const activity = [];
  await verifyLocalArchive(f.archive, f.source, {
    progress: (v) => activity.push(v),
  });
  assert.equal(activity[0].bytes, 0);
  assert.equal(activity.at(-1).bytes, f.source.bytes);
  await assert.rejects(
    verifyLocalArchive(f.archive, { ...f.source, bytes: 50_000_000_001 }),
    /limits/,
  );
  let changed = false;
  await assert.rejects(
    verifyLocalArchive(f.archive, f.source, {
      progress: ({ bytes }) => {
        if (bytes && !changed) {
          changed = true;
          fs.appendFileSync(f.archive, 'changed');
        }
      },
    }),
    /SHA-256/,
  );
  assert.equal(fs.statSync(f.archive).size, f.source.bytes + 7);
  fs.truncateSync(f.archive, f.source.bytes);
  let view = await f.guide.select(
    f.view.id,
    'archive',
    f.source.id,
    async () => f.archive,
  );
  view = await f.guide.review(view.id);
  fs.writeFileSync(f.archive, 'replaced after review');
  f.guide.start(view.id, view.plan.id);
  await f.builder.done;
  assert.equal(f.builder.jobs[0].status, 'failed');
  assert.equal(f.requests, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import yazl from 'yazl';
import { createNativeFixture } from './native-fixture.mjs';
import { packNativeRecipe } from '../scripts/native-package.mjs';
const require = createRequire(import.meta.url);
const { materializeNative } = require('../electron/native-materializer.cjs');
const fingerprint = (data) => ({
  bytes: Buffer.byteLength(data),
  sha256: crypto.createHash('sha256').update(data).digest('hex'),
});
async function fixture(unsafe = false, timestamps = false) {
  const f = createNativeFixture();
  f.game = path.join(f.root, 'owned');
  f.packages = path.join(f.root, 'packages');
  fs.mkdirSync(f.game);
  fs.mkdirSync(f.packages);
  fs.writeFileSync(path.join(f.game, 'FalloutNV.exe'), 'fixture owned game');
  f.archive = path.join(f.packages, 'source.zip');
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from('original mod bytes'), 'Data/Example.esp');
  if (unsafe)
    zip.addBuffer(Buffer.from('elsewhere'), 'redirect', { mode: 0o120777 });
  const writing = pipeline(zip.outputStream, fs.createWriteStream(f.archive));
  zip.end();
  await writing;
  f.recipe.sources.push({
    id: 'original-archive',
    type: 'https-archive',
    url: 'https://example.org/original.zip',
    ...fingerprint(fs.readFileSync(f.archive)),
    credit: { name: 'Fixture author', url: 'https://example.org/credits' },
  });
  f.recipe.outputs.push({
    path: 'mods/Example/Example.esp',
    ...fingerprint('original mod bytes'),
    action: {
      type: 'extract',
      source: 'original-archive',
      member: 'Data/Example.esp',
    },
  });
  f.package = path.join(f.packages, 'fixture.loadstone');
  if (timestamps)
    for (const [index, output] of f.recipe.outputs.entries())
      output.mtimeMs = 946684800123 + index * 86400000;
  await packNativeRecipe(f.recipe, f.payloads, f.package);
  f.destination = path.join(f.root, 'installed');
  f.options = {
    games: { fnv: f.game },
    archives: { 'original-archive': f.archive },
  };
  return f;
}
test('copy and ZIP reconstruction preserves declared timestamps without retiming inputs', async () => {
  const f = await fixture(false, true);
  const inputs = [
    path.join(f.game, 'FalloutNV.exe'),
    f.archive,
    f.package,
    ...fs.readdirSync(f.payloads).map((v) => path.join(f.payloads, v)),
  ];
  const before = inputs.map((v) => [
    fs.statSync(v).mtimeMs,
    fingerprint(fs.readFileSync(v)),
  ]);
  await materializeNative(f.package, f.destination, f.options);
  for (const output of f.recipe.outputs) {
    const file = path.join(f.destination, output.path);
    assert.equal(Math.round(fs.statSync(file).mtimeMs), output.mtimeMs);
    assert.equal(fingerprint(fs.readFileSync(file)).sha256, output.sha256);
  }
  assert.deepEqual(
    inputs.map((v) => [
      fs.statSync(v).mtimeMs,
      fingerprint(fs.readFileSync(v)),
    ]),
    before,
  );
});

test('timestamp write failure leaves a failed receipt and never modifies source metadata', async (t) => {
  const f = await fixture(false, true),
    input = path.join(f.game, 'FalloutNV.exe');
  const before = fs.statSync(input).mtimeMs;
  t.mock.method(fs, 'futimesSync', () => {
    throw new Error('fixture metadata write failure');
  });
  await assert.rejects(
    materializeNative(f.package, f.destination, f.options),
    /metadata write failure/,
  );
  const receipt = JSON.parse(
    fs.readFileSync(path.join(f.destination, '.loadstone-native.json')),
  );
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.completedFiles, 0);
  assert.equal(fs.statSync(input).mtimeMs, before);
});

test('timestamped reconstruction still rejects bad inputs before writes and detects metadata drift in final verification', async () => {
  const f = await fixture(false, true);
  const input = path.join(f.game, 'FalloutNV.exe');
  const original = fs.readFileSync(input);
  fs.writeFileSync(input, Buffer.alloc(original.length, 88));
  const changedTime = fs.statSync(input).mtimeMs;
  await assert.rejects(
    materializeNative(f.package, f.destination, f.options),
    /recipe hash/,
  );
  assert.equal(fs.existsSync(f.destination), false);
  assert.equal(fs.statSync(input).mtimeMs, changedTime);
  fs.writeFileSync(input, original);
  const plugin = path.join(f.destination, 'mods/Example/Example.esp');
  await assert.rejects(
    materializeNative(f.package, f.destination, {
      ...f.options,
      progress: ({ completed }) => {
        if (completed === f.recipe.outputs.length)
          fs.utimesSync(plugin, new Date(946684800000), new Date(946684800000));
      },
    }),
    /modification time differs/,
  );
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(f.destination, '.loadstone-native.json')),
    ).status,
    'failed',
  );
});

test('native reconstruction copies owned inputs and locked ZIP/payload bytes into a fresh isolated folder', async () => {
  const f = await fixture(),
    archiveBefore = fs.readFileSync(f.archive),
    packageBefore = fs.readFileSync(f.package);
  // Cached filenames can be mislabeled; byte identity and parser checks govern.
  const mislabeled = path.join(f.packages, 'source.7z');
  fs.copyFileSync(f.archive, mislabeled);
  f.options.archives['original-archive'] = mislabeled;
  const result = await materializeNative(f.package, f.destination, f.options);
  assert.equal(result.status, 'verified');
  assert.equal(result.completedFiles, 6);
  assert.equal(result.launchVerified, false);
  for (const output of f.recipe.outputs)
    assert.deepEqual(
      fingerprint(fs.readFileSync(path.join(f.destination, output.path))),
      { bytes: output.bytes, sha256: output.sha256 },
    );
  assert.deepEqual(fs.readFileSync(f.archive), archiveBefore);
  assert.deepEqual(fs.readFileSync(f.package), packageBefore);
  assert.equal(
    fs.readFileSync(path.join(f.game, 'FalloutNV.exe'), 'utf8'),
    'fixture owned game',
  );
  const receipt = JSON.parse(
    fs.readFileSync(path.join(f.destination, '.loadstone-native.json'), 'utf8'),
  );
  assert.deepEqual(receipt, result);
  assert.equal(JSON.stringify(receipt).includes(f.root), false);
  await assert.rejects(
    materializeNative(f.package, f.destination, f.options),
    /new, ordinary destination/,
  );
});

test('native activity separates input checks, archive checks, writing and final verification without exposing paths', async () => {
  const f = await fixture(),
    events = [];
  let reconstructed = 0;
  await materializeNative(f.package, f.destination, {
    ...f.options,
    progress: (v) => {
      reconstructed = v.completed;
    },
    activity: (v) => {
      events.push(v);
      assert.deepEqual(Object.keys(v).sort(), [
        'bytes',
        'completed',
        'phase',
        'total',
        'totalBytes',
      ]);
      for (const key of ['bytes', 'completed', 'total', 'totalBytes'])
        assert.ok(Number.isSafeInteger(v[key]) && v[key] >= 0);
      assert.ok(v.bytes <= v.totalBytes);
      assert.ok(v.completed <= v.total);
      if (v.phase === 'inputs' || v.phase === 'archives')
        assert.equal(fs.existsSync(f.destination), false);
      if (v.phase === 'verification')
        assert.equal(reconstructed, f.recipe.outputs.length);
    },
  });
  assert.deepEqual(
    [...new Set(events.map((v) => v.phase))],
    ['inputs', 'archives', 'outputs', 'verification'],
  );
  for (const phase of ['inputs', 'archives', 'outputs', 'verification']) {
    const items = events.filter((v) => v.phase === phase);
    assert.equal(items[0].completed, 0);
    assert.equal(items.at(-1).completed, items.at(-1).total);
  }
  assert.equal(events.findLast((v) => v.phase === 'inputs').total, 2);
  assert.equal(events.findLast((v) => v.phase === 'archives').total, 2);
  assert.equal(events.at(-1).total, f.recipe.outputs.length);
  assert.equal(JSON.stringify(events).includes(f.root), false);
  const cancelled = await fixture(),
    controller = new AbortController();
  await assert.rejects(
    materializeNative(cancelled.package, cancelled.destination, {
      ...cancelled.options,
      signal: controller.signal,
      activity: (v) => {
        if (v.phase === 'inputs' && v.bytes > 0) controller.abort();
      },
    }),
    { name: 'AbortError' },
  );
  assert.equal(fs.existsSync(cancelled.destination), false);
});
test('native preflight rejects wrong game/archive bytes, redirects, source overlap and unsafe ZIP entries before writes', async () => {
  const f = await fixture();
  await assert.rejects(
    materializeNative(f.package, path.join(f.game, 'nested'), f.options),
    /separate from source/,
  );
  fs.symlinkSync(f.game, path.join(f.root, 'alias'), 'junction');
  await assert.rejects(
    materializeNative(f.package, path.join(f.root, 'alias/new'), f.options),
    /ordinary destination/,
  );
  fs.writeFileSync(path.join(f.game, 'FalloutNV.exe'), 'wrong game');
  await assert.rejects(
    materializeNative(f.package, f.destination, f.options),
    /byte length/,
  );
  assert.equal(fs.existsSync(f.destination), false);
  fs.writeFileSync(path.join(f.game, 'FalloutNV.exe'), 'fixture owned game');
  fs.appendFileSync(f.archive, 'changed');
  await assert.rejects(materializeNative(f.package, f.destination, f.options));
  assert.equal(fs.existsSync(f.destination), false);
  const bad = await fixture(true);
  await assert.rejects(
    materializeNative(bad.package, bad.destination, bad.options),
    /Unsafe/,
  );
  assert.equal(fs.existsSync(bad.destination), false);
});
test('native cancellation preserves a marked partial folder and final verification catches changed outputs', async () => {
  const f = await fixture(),
    controller = new AbortController();
  await assert.rejects(
    materializeNative(f.package, f.destination, {
      ...f.options,
      signal: controller.signal,
      progress: () => controller.abort(),
    }),
    { name: 'AbortError' },
  );
  const receipt = JSON.parse(
    fs.readFileSync(path.join(f.destination, '.loadstone-native.json'), 'utf8'),
  );
  assert.equal(receipt.status, 'cancelled');
  assert.equal(receipt.completedFiles, 1);
  assert.equal(
    fs.readFileSync(path.join(f.game, 'FalloutNV.exe'), 'utf8'),
    'fixture owned game',
  );
  const changed = await fixture();
  await assert.rejects(
    materializeNative(changed.package, changed.destination, {
      ...changed.options,
      progress: ({ completed }) => {
        if (completed === 1)
          fs.writeFileSync(
            path.join(changed.destination, 'Game/FalloutNV.exe'),
            Buffer.alloc(changed.recipe.outputs[0].bytes, 'x'),
          );
      },
    }),
    /byte length|recipe hash/,
  );
  assert.equal(
    JSON.parse(
      fs.readFileSync(
        path.join(changed.destination, '.loadstone-native.json'),
        'utf8',
      ),
    ).status,
    'failed',
  );
});

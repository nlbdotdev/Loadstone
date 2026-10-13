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
async function fixture(unsafe = false) {
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
  await packNativeRecipe(f.recipe, f.payloads, f.package);
  f.destination = path.join(f.root, 'installed');
  f.options = {
    games: { fnv: f.game },
    archives: { 'original-archive': f.archive },
  };
  return f;
}
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

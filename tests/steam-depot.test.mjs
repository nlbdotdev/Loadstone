import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import asar from '@electron/asar';
import { finished } from 'node:stream/promises';
import {
  stagePackage,
  verifyKit,
  steamScripts,
} from '../scripts/steam-depot.mjs';
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-depot-'));
  const source = path.join(root, 'unpacked'),
    app = path.join(root, 'app');
  fs.mkdirSync(path.join(source, 'resources/notices'), { recursive: true });
  fs.mkdirSync(path.join(source, 'resources/licenses'), { recursive: true });
  for (const [original, target] of [
    ['LICENSE', 'Loadstone-GPL-3.0.txt'],
    ['COPYRIGHT', 'Loadstone-COPYRIGHT.txt'],
  ])
    fs.copyFileSync(
      path.join(import.meta.dirname, '..', original),
      path.join(source, 'resources/licenses', target),
    );
  fs.mkdirSync(path.join(app, 'electron'), { recursive: true });
  fs.mkdirSync(path.join(app, 'dist'));
  fs.writeFileSync(
    path.join(app, 'package.json'),
    JSON.stringify({
      name: 'loadstone',
      main: 'electron/main.cjs',
      version: '0.1.0',
      license: 'GPL-3.0-or-later',
    }),
  );
  fs.writeFileSync(
    path.join(app, 'dist/build-info.json'),
    JSON.stringify({
      commit: 'a'.repeat(40),
      dirty: false,
      lockfileSha256: 'b'.repeat(64),
    }),
  );
  for (const file of [
    'electron/main.cjs',
    'electron/preload.cjs',
    'dist/index.html',
  ])
    fs.writeFileSync(path.join(app, file), 'fixture');
  fs.writeFileSync(
    path.join(app, 'dist/frontend-notices.json'),
    JSON.stringify({
      schemaVersion: 1,
      packages: [{ name: 'fixture', version: '1.0.0', notices: [] }],
    }),
  );
  // ASAR 3.4 returns the writer after end(), before its final writes finish.
  // A fixture reader must wait for those bytes instead of racing the stream.
  const archiveWriter = await asar.createPackage(
    app,
    path.join(source, 'resources/app.asar'),
  );
  await finished(archiveWriter, { cleanup: true });
  for (const file of [
    'LICENSE.electron.txt',
    'LICENSES.chromium.html',
    'resources/notices/THIRD-PARTY.txt',
  ])
    fs.writeFileSync(path.join(source, file), 'fixture notices');
  fs.writeFileSync(
    path.join(source, 'resources/notices/dependencies.json'),
    JSON.stringify({
      packages: [
        {
          name: 'fixture',
          version: '1.0.0',
          scopes: ['renderer-bundle'],
          notices: [],
        },
      ],
      missingLicenseTexts: ['fixture-gap'],
    }),
  );
  const exe = Buffer.alloc(128);
  exe.write('MZ');
  exe.writeUInt32LE(64, 60);
  exe.writeUInt32LE(0x4550, 64);
  exe.writeUInt16LE(0x8664, 68);
  fs.writeFileSync(path.join(source, 'Loadstone.exe'), exe);
  return { root, source, destination: path.join(root, 'kit') };
}
test('depot staging preserves runtime and notices, records hashes and produces preview-only templates', async () => {
  const h = await fixture();
  const manifest = await stagePackage(h.source, h.destination);
  assert.equal(manifest.releaseApproved, false);
  assert.equal(manifest.license, 'GPL-3.0-or-later');
  assert.deepEqual(manifest.noticeGaps, ['fixture-gap']);
  assert.equal(JSON.stringify(manifest).includes(h.root), false);
  assert.deepEqual(await verifyKit(h.destination), manifest);
  const script = fs.readFileSync(
    path.join(h.destination, 'scripts/app_build.vdf.template'),
    'utf8',
  );
  assert.match(script, /"Preview" "1"/);
  assert.doesNotMatch(script, /SetLive/);
  assert.match(script, /YOUR_APP_ID/);
  await assert.rejects(
    stagePackage(h.source, h.destination),
    /never overwritten/,
  );
  fs.appendFileSync(
    path.join(h.destination, 'content/Loadstone.exe'),
    'changed',
  );
  await assert.rejects(verifyKit(h.destination), /differ/);
});
test('depot staging rejects missing notices, wrong architecture, nested output and unsafe Steam IDs', async () => {
  const h = await fixture();
  await assert.rejects(
    stagePackage(h.source, path.join(h.source, 'kit')),
    /outside/,
  );
  for (const id of ['0', '-1', '4294967296', '123"\nSetLive', 'abc'])
    assert.throws(() => steamScripts(id, '123'), /integers/);
  assert.match(steamScripts('123', '456').app, /"456" "depot_build.vdf"/);
  fs.writeFileSync(path.join(h.source, 'Loadstone.exe'), 'not an executable');
  await assert.rejects(stagePackage(h.source, h.destination), /executable/);
  const other = await fixture();
  fs.unlinkSync(path.join(other.source, 'LICENSE.electron.txt'));
  await assert.rejects(stagePackage(other.source, other.destination));
  assert.equal(fs.existsSync(other.destination), false);
});

test('depot rejects a renderer dependency omitted from shipped attribution', async () => {
  const h = await fixture();
  const file = path.join(h.source, 'resources/notices/dependencies.json');
  const notices = JSON.parse(fs.readFileSync(file, 'utf8'));
  notices.packages[0].name = 'unrelated';
  fs.writeFileSync(file, JSON.stringify(notices));
  await assert.rejects(
    stagePackage(h.source, h.destination),
    /absent from shipped notices/,
  );
  assert.equal(fs.existsSync(h.destination), false);
});

test('depot rejects omitted or altered Loadstone license and scope notice before staging', async () => {
  for (const [file, replacement] of [
    ['Loadstone-GPL-3.0.txt', null],
    ['Loadstone-GPL-3.0.txt', 'truncated license'],
    ['Loadstone-COPYRIGHT.txt', 'SPDX-License-Identifier: GPL-3.0-only'],
  ]) {
    const h = await fixture();
    const target = path.join(h.source, 'resources/licenses', file);
    if (replacement === null) fs.unlinkSync(target);
    else fs.writeFileSync(target, replacement);
    await assert.rejects(stagePackage(h.source, h.destination));
    assert.equal(fs.existsSync(h.destination), false);
  }
});

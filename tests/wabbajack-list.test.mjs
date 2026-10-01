import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { writeList, listMetadata } from './list-fixture.mjs';
const require = createRequire(import.meta.url);
const { inspectList } = require('../electron/wabbajack-list.cjs');
const { parseGameLocations } = require('../electron/runtime.cjs');
const manifest = {
  game: { id: 'fnv' },
  storage: { installBytes: 1024, downloadBytes: 1024 },
  launch: { profile: 'Fixture' },
};
test('list inspection confirms the actual game/profile and rejects unsafe or incompatible plans', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-list-')),
    file = path.join(root, 'test.wabbajack');
  await writeList(file);
  assert.equal((await inspectList(file, manifest, '4.2.3.0')).files, 3);
  for (const mutate of [
    (m) => (m.GameType = 'SkyrimSpecialEdition'),
    (m) => (m.OtherGames = ['Fallout3']),
    (m) => (m.WabbajackVersion = '5.0.0.0'),
    (m) => (m.Directives[0].To = '../escape.exe'),
    (m) => (m.Directives[0].To = 'mods/CON.txt'),
    (m) => (m.Directives[0].To = 'mods/ambiguous. '),
    (m) => m.Directives.push({ ...m.Directives[0] }),
    (m) => (m.Directives[0].Size = 1000000),
    (m) => (m.Directives[2].To = 'profiles/Other/modlist.txt'),
  ]) {
    const metadata = listMetadata();
    mutate(metadata);
    await writeList(file, metadata);
    await assert.rejects(inspectList(file, manifest, '4.2.3.0'));
  }
  const manual = listMetadata();
  manual.Archives = [
    { Size: 1, State: { $type: 'ManualDownloader, Wabbajack.Lib' } },
  ];
  await writeList(file, manual);
  assert.deepEqual(
    (await inspectList(file, manifest, '4.2.3.0')).unsupportedSources,
    ['ManualDownloader'],
  );
});
test('engine game parsing accepts confirmed game selections and rejects ambiguity', () => {
  const game = path.join(os.tmpdir(), 'Game');
  const log = `00:00:02.000 [INFO] [X] Fallout New Vegas 1.4.0.525 -> Path: ${game}`;
  assert.deepEqual(parseGameLocations(log), [
    { id: 'fnv', version: '1.4.0.525', folder: game },
  ]);
  assert.deepEqual(
    parseGameLocations(
      'Found SteamGame { Path = C:/Other }\n[INFO] [ ] Fallout New Vegas',
    ),
    [],
  );
  assert.throws(() => parseGameLocations(log + '\n' + log), /ambiguous/);
});

test('isolated layouts require the game executable among the actual archive outputs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-stock-')),
    file = path.join(root, 'stock.wabbajack');
  const declared = structuredClone(manifest);
  declared.launch.gameRoot = 'Stock Game';
  const metadata = listMetadata();
  await writeList(file, metadata);
  await assert.rejects(
    inspectList(file, declared, '4.2.3.0'),
    /isolated game folder/,
  );
  metadata.Directives.push({
    To: 'Stock Game/FalloutNV.exe',
    Size: 1,
    $type: 'FromArchive',
  });
  await writeList(file, metadata);
  assert.equal((await inspectList(file, declared, '4.2.3.0')).files, 4);
});

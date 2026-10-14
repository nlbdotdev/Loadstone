import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  createArchiveFixture,
  fingerprint,
  storedZip,
} from './native-archive-fixture.mjs';
import { packNativeRecipe } from '../scripts/native-package.mjs';
const require = createRequire(import.meta.url);
const { mapArchiveSources } = require('../electron/archive-mapping.cjs');
const { materializeNative } = require('../electron/native-materializer.cjs');
const { inspectNativePackage } = require('../electron/native-package.cjs');
const {
  canonicalJson,
  validateRecipe,
} = require('../electron/native-format.cjs');

function ledger(f) {
  return {
    kind: 'loadstone-source-ledger',
    schemaVersion: 1,
    mods: [
      {
        name: 'Example',
        enabled: true,
        installedFiles: [...f.files].map(([name, data]) => ({
          path: name,
          ...fingerprint(data),
        })),
        archiveCandidates: [
          { archive: f.archive, ...fingerprint(fs.readFileSync(f.archive)) },
        ],
      },
    ],
  };
}
async function replaceArchive(f, entries) {
  fs.writeFileSync(f.archive, storedZip(entries));
  Object.assign(
    f.recipe.sources.find((s) => s.id === 'original-archive'),
    fingerprint(fs.readFileSync(f.archive)),
  );
  f.packageFile = path.join(f.packages, 'reviewed.loadstone');
  await packNativeRecipe(f.recipe, f.payloads, f.packageFile);
}

test('Windows ZIP names map to canonical members and reconstruct exact files without altering the archive', async () => {
  const f = await createArchiveFixture('zip-windows');
  await replaceArchive(f, [
    ['Data\\', Buffer.alloc(0), 0o040755],
    ...[...f.files].map(([name, data], i) => [
      i % 2 ? name.replaceAll('/', '\\') : name,
      data,
    ]),
  ]);
  const before = fs.readFileSync(f.archive),
    beforeTime = fs.statSync(f.archive).mtimeMs;
  const mapped = await mapArchiveSources(ledger(f));
  assert.equal(mapped.mapping.issues.length, 0);
  assert.equal(mapped.mapping.matchedInstalledFiles, f.files.size);
  for (const file of mapped.mods[0].installedFiles) {
    const match = file.sourceMatches[0];
    assert.equal(match.member, file.path);
    assert.equal(match.member.includes('\\'), false);
    for (const output of f.recipe.outputs.filter(
      (v) => v.action.member === file.path,
    ))
      output.action.member = match.member;
  }
  f.packageFile = path.join(f.packages, 'mapped.loadstone');
  await packNativeRecipe(f.recipe, f.payloads, f.packageFile);
  const result = await materializeNative(
    f.packageFile,
    f.destination,
    f.options,
  );
  assert.equal(result.status, 'verified');
  for (const output of f.recipe.outputs)
    assert.equal(
      fingerprint(fs.readFileSync(path.join(f.destination, output.path)))
        .sha256,
      output.sha256,
    );
  assert.deepEqual(fs.readFileSync(f.archive), before);
  assert.equal(fs.statSync(f.archive).mtimeMs, beforeTime);
});

test('ZIP separator normalization rejects traversal, aliases, links and file/directory overlap before destination writes', async () => {
  const badGroups = [
    ...[
      '..\\outside',
      'Data\\..\\outside',
      '\\absolute',
      'C:\\absolute',
      '\\\\server\\share',
      'Data\\\\double',
      'Data\\.\\relative',
      'Data\\nul.txt',
      'Data\\trailing.',
      'Data\\file:stream',
      'Data\\e\u0301.txt',
    ].map((name) => [[name, Buffer.from('bad')]]),
    [['Data\\A[1].esp', Buffer.from('alias')]],
    [['data\\a[1].ESP', Buffer.from('case alias')]],
    [['Data', Buffer.from('file conflicts with children')]],
    [
      ['Data\\Alias', Buffer.from('file')],
      ['Data/Alias/Child', Buffer.from('child')],
    ],
    [
      ['Data\\Alias\\Child', Buffer.from('child')],
      ['Data/Alias', Buffer.from('file')],
    ],
    [
      ['Data\\Alias\\', Buffer.alloc(0), 0o040755],
      ['Data/Alias', Buffer.from('file')],
    ],
    [['Data\\redirect', Buffer.from('elsewhere'), 0o120777]],
  ];
  for (const extras of badGroups) {
    const f = await createArchiveFixture('zip-windows');
    await replaceArchive(f, [...f.files, ...extras]);
    const before = fingerprint(fs.readFileSync(f.archive));
    const mapped = await mapArchiveSources(ledger(f));
    assert.equal(mapped.mapping.inspected.length, 0, extras[0][0]);
    assert.equal(mapped.mapping.issues.length, 1, extras[0][0]);
    assert.equal(mapped.mapping.matchedInstalledFiles, 0, extras[0][0]);
    await assert.rejects(
      materializeNative(f.packageFile, f.destination, f.options),
    );
    assert.equal(fs.existsSync(f.destination), false, extras[0][0]);
    assert.deepEqual(fingerprint(fs.readFileSync(f.archive)), before);
  }
});

test('native package and recipe names remain strict when upstream ZIP separators are normalized', async () => {
  const f = await createArchiveFixture('zip-windows');
  const invalid = structuredClone(f.recipe);
  invalid.outputs.find((v) => v.action.type === 'extract').action.member =
    'Data\\00-empty.txt';
  assert.throws(() => validateRecipe(invalid), /safe member path/);
  const packageFile = path.join(f.packages, 'backslash-payload.loadstone');
  const entries = [
    ['recipe.json', Buffer.from(canonicalJson(f.recipe))],
    ...f.recipe.sources
      .filter((s) => s.type === 'payload')
      .map((s) => [
        `payload\\${s.sha256}`,
        fs.readFileSync(path.join(f.payloads, s.sha256)),
      ]),
  ];
  fs.writeFileSync(packageFile, storedZip(entries));
  await assert.rejects(inspectNativePackage(packageFile), /invalid characters/);
  await assert.rejects(
    materializeNative(packageFile, f.destination, f.options),
    /invalid characters/,
  );
  assert.equal(fs.existsSync(f.destination), false);
});

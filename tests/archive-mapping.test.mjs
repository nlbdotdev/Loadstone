import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import yazl from 'yazl';
const require = createRequire(import.meta.url);
const { mapZipSources } = require('../electron/archive-mapping.cjs');
const { archiveKind } = require('../electron/archive-kind.cjs');
const fingerprint = (data) => ({
  bytes: Buffer.byteLength(data),
  sha256: crypto.createHash('sha256').update(data).digest('hex'),
});
async function fixture(extra = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-mapping-'));
  const archive = path.join(root, 'original.zip'),
    zip = new yazl.ZipFile();
  for (const [name, text, mode] of [
    ['Data/Example.esp', 'unchanged'],
    ['Data/Edited.ini', 'original'],
    ['meta.ini', 'private metadata'],
    ...extra,
  ])
    zip.addBuffer(Buffer.from(text), name, { mode: mode || 0o100644 });
  const writing = pipeline(zip.outputStream, fs.createWriteStream(archive));
  zip.end();
  await writing;
  const ledger = {
    kind: 'loadstone-source-ledger',
    schemaVersion: 1,
    mods: [
      {
        name: 'Current mod',
        enabled: true,
        installedFiles: [
          { path: 'Example.esp', ...fingerprint('unchanged') },
          { path: 'Edited.ini', ...fingerprint('locally changed') },
          { path: 'meta.ini', ...fingerprint('private metadata') },
        ],
        archiveCandidates: [
          { archive, ...fingerprint(fs.readFileSync(archive)) },
        ],
      },
    ],
  };
  return { root, archive, ledger };
}
test('ZIP mapping proves member bytes while retaining local changes and private metadata as unresolved', async () => {
  const f = await fixture();
  const result = await mapZipSources(f.ledger);
  assert.equal(result.mapping.inspected.length, 1);
  assert.equal(result.mapping.matchedInstalledFiles, 1);
  assert.equal(result.mapping.unmatchedInstalledFiles, 2);
  assert.equal(
    result.mods[0].installedFiles[0].sourceMatches[0].member,
    'Data/Example.esp',
  );
  assert.equal(result.mods[0].installedFiles[1].sourceMatches.length, 0);
  assert.equal(result.mods[0].installedFiles[2].sourceMatches.length, 0);
  assert.equal(f.ledger.mods[0].installedFiles[0].sourceMatches, undefined);
  assert.equal(result.publicationApproved, false);
  assert.equal(result.installable, false);
});

test('archive mapping retains disabled state while resolving inventoried optional mod files', async () => {
  const f = await fixture();
  f.ledger.mods[0].enabled = false;
  const result = await mapZipSources(f.ledger);
  assert.equal(result.mods[0].enabled, false);
  assert.equal(result.mapping.matchedInstalledFiles, 1);
  assert.equal(
    result.mods[0].installedFiles[0].sourceMatches[0].member,
    'Data/Example.esp',
  );
  assert.equal(result.installable, false);
});

test('ZIP mapping compacts identical content without hiding different candidates or accepting unsafe trailing entries', async () => {
  const copies = Array.from({ length: 1001 }, (_, i) => [
    `Textures/${String(i).padStart(4, '0')}.dds`,
    'repeated texture',
  ]);
  const f = await fixture([...copies].reverse());
  f.ledger.mods[0].installedFiles.push(
    ...copies.map(([name, data]) => ({ path: name, ...fingerprint(data) })),
  );
  f.ledger.mods[0].installedFiles.push({
    path: 'changed.dds',
    ...fingerprint('repeated texturE'),
  });
  const second = await fixture([['Alternate.dds', 'repeated texture']]);
  f.ledger.mods[0].archiveCandidates.push(
    second.ledger.mods[0].archiveCandidates[0],
  );
  const before = fs.readFileSync(f.archive);
  const mapped = await mapZipSources(f.ledger);
  assert.equal(mapped.mapping.issues.length, 0);
  assert.equal(mapped.mapping.matchedInstalledFiles, 1002);
  assert.equal(
    mapped.mapping.memberSelection,
    'lexicographic-representative-per-content',
  );
  for (const file of mapped.mods[0].installedFiles.slice(3, -1)) {
    assert.equal(file.sourceMatches.length, 2);
    assert.deepEqual(
      file.sourceMatches.map(({ member, equivalentMembers }) => ({
        member,
        equivalentMembers,
      })),
      [
        { member: 'Textures/0000.dds', equivalentMembers: 1001 },
        { member: 'Alternate.dds', equivalentMembers: 1 },
      ],
    );
  }
  assert.equal(mapped.mods[0].installedFiles.at(-1).sourceMatches.length, 0);
  assert.equal(mapped.installable, false);
  assert.equal(mapped.publicationApproved, false);
  assert.deepEqual(fs.readFileSync(f.archive), before);
  const invalid = await fixture([
    ...copies,
    ['redirect', 'elsewhere', 0o120777],
  ]);
  invalid.ledger.mods[0].installedFiles = f.ledger.mods[0].installedFiles;
  const refused = await mapZipSources(invalid.ledger);
  assert.equal(refused.mapping.issues.length, 1);
  assert.equal(refused.mapping.matchedInstalledFiles, 0);
});
test('ZIP mapping accepts no partial matches from changed, redirected or ambiguous archives and supports cancellation', async () => {
  for (const extra of [
    [['Data/example.ESP', 'duplicate']],
    [['redirect', 'elsewhere', 0o120777]],
    [['Data', 'overlap']],
  ]) {
    const f = await fixture(extra),
      result = await mapZipSources(f.ledger);
    assert.equal(result.mapping.inspected.length, 0);
    assert.equal(result.mapping.issues.length, 1);
    assert.equal(result.mapping.matchedInstalledFiles, 0);
  }
  const f = await fixture();
  fs.appendFileSync(f.archive, 'changed after ledger');
  assert.equal(
    (await mapZipSources(f.ledger)).mapping.matchedInstalledFiles,
    0,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(mapZipSources(f.ledger, { signal: controller.signal }), {
    name: 'AbortError',
  });
  f.ledger.mods[0].archiveCandidates[0].archive = path.join(
    f.root,
    'unread.7z',
  );
  const unsupported = await mapZipSources(f.ledger);
  assert.equal(unsupported.mapping.issues.length, 1);
  assert.equal(unsupported.mapping.matchedInstalledFiles, 0);
});

test('content detection maps mislabeled ZIPs without renaming originals and refuses fake or embedded signatures', async () => {
  const f = await fixture();
  const mislabeled = path.join(f.root, 'download.7z');
  fs.copyFileSync(f.archive, mislabeled);
  const original = fs.readFileSync(mislabeled);
  f.ledger.mods[0].archiveCandidates[0].archive = mislabeled;
  assert.equal(archiveKind(mislabeled), 'zip');
  const mapped = await mapZipSources(f.ledger);
  assert.equal(mapped.mapping.inspected.length, 1);
  assert.equal(mapped.mapping.matchedInstalledFiles, 1);
  assert.deepEqual(fs.readFileSync(mislabeled), original);
  for (const data of [
    Buffer.from('PK'),
    Buffer.from('not an archive'),
    Buffer.concat([Buffer.from('MZ'), original]),
  ]) {
    const bad = path.join(f.root, 'fake.zip');
    fs.writeFileSync(bad, data);
    assert.throws(() => archiveKind(bad), /signature/);
  }
  // A valid prefix chooses a parser, but never substitutes for archive validity.
  fs.writeFileSync(mislabeled, Buffer.from('504b030400000000', 'hex'));
  Object.assign(
    f.ledger.mods[0].archiveCandidates[0],
    fingerprint(fs.readFileSync(mislabeled)),
  );
  assert.equal(
    (await mapZipSources(f.ledger)).mapping.matchedInstalledFiles,
    0,
  );
});

test('RAR signatures select the correct legacy or RAR5 parser', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'loadstone-rar-signature-'),
  );
  const file = path.join(root, 'sample.7z');
  for (const [signature, expected] of [
    ['526172211a0700', 'rar'],
    ['526172211a070100', 'rar5'],
  ]) {
    fs.writeFileSync(file, Buffer.from(signature, 'hex'));
    assert.equal(archiveKind(file), expected);
  }
});

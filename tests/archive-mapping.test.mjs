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
  assert.match(unsupported.mapping.issues[0].reason, /Only ZIP/);
  assert.equal(unsupported.mapping.matchedInstalledFiles, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSourceLedger } = require('../electron/source-ledger.cjs');
const fingerprint = (text) => ({
  bytes: Buffer.byteLength(text),
  sha256: crypto.createHash('sha256').update(text).digest('hex'),
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-ledger-'));
  const inventory = {
    schemaVersion: 1,
    kind: 'loadstone-installed-inventory',
    fileHashing: 'sha256',
    source: { profile: 'Current', gameName: 'New Vegas' },
    mods: [
      {
        name: 'Installed edited mod',
        position: 0,
        enabled: true,
        present: true,
        metadata: {
          installationFile: 'Original.zip',
          modid: '123',
          apiKey: 'synthetic-secret',
        },
        files: [
          { path: 'Example.esp', ...fingerprint('modified installed content') },
        ],
      },
    ],
    overwrite: [{ path: 'generated.txt', ...fingerprint('generated') }],
  };
  fs.writeFileSync(path.join(root, 'Original.zip'), 'original archive bytes');
  fs.writeFileSync(
    path.join(root, 'Original.zip.meta'),
    '[General]\ngameName=FalloutNV\nmodID=123\nfileID=456\napiKey=synthetic-secret\nurl=https://example.org/?token=synthetic-secret\n',
  );
  return { root, inventory };
}
test('source ledger fingerprints candidate downloads without claiming that installed edits or permissions are resolved', async () => {
  const f = fixture();
  const ledger = await buildSourceLedger(f.inventory, [f.root]);
  const mod = ledger.mods[0],
    candidate = mod.archiveCandidates[0];
  assert.deepEqual(candidate.nexus, {
    game: 'falloutnv',
    modId: 123,
    fileId: 456,
  });
  assert.equal(candidate.sha256, fingerprint('original archive bytes').sha256);
  assert.deepEqual(mod.installedFiles, f.inventory.mods[0].files);
  assert.equal(mod.reconstruction, 'unresolved');
  assert.equal(mod.permissions, 'unreviewed');
  assert.equal(ledger.summary.resolvedFiles, 0);
  assert.equal(ledger.installable, false);
  assert.equal(ledger.publicationApproved, false);
  assert.equal(JSON.stringify(ledger).includes('synthetic-secret'), false);
  assert.equal(ledger.overwrite.length, 1);
});
test('source ledger retains ambiguity, rejects incomplete hashes, and refuses redirected downloads', async () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.root, 'Another.zip'), 'another archive');
  fs.writeFileSync(
    path.join(f.root, 'Another.zip.meta'),
    '[General]\ngameName=FalloutNV\nmodID=123\nfileID=789\n',
  );
  fs.writeFileSync(
    path.join(f.root, 'WrongGame.zip'),
    'different game archive',
  );
  fs.writeFileSync(
    path.join(f.root, 'WrongGame.zip.meta'),
    '[General]\ngameName=Fallout4\nmodID=123\nfileID=789\n',
  );
  let ledger = await buildSourceLedger(f.inventory, [f.root]);
  assert.equal(ledger.mods[0].archiveCandidates.length, 2);
  assert.equal(ledger.summary.resolvedFiles, 0);
  f.inventory.mods[0].metadata.modid = '999';
  ledger = await buildSourceLedger(f.inventory, [f.root]);
  assert.equal(ledger.mods[0].archiveCandidates[0].metadataConflict, true);
  delete f.inventory.mods[0].files[0].sha256;
  await assert.rejects(
    buildSourceLedger(f.inventory, [f.root]),
    /complete SHA-256/,
  );
  const outer = fs.mkdtempSync(
    path.join(os.tmpdir(), 'loadstone-ledger-link-'),
  );
  fs.symlinkSync(f.root, path.join(outer, 'redirect'), 'junction');
  await assert.rejects(
    buildSourceLedger(f.inventory, [path.join(outer, 'redirect')]),
    /redirected/,
  );
});

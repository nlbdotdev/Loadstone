import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { listMetadata, writeList } from './list-fixture.mjs';
const { verifyOutputs } = createRequire(import.meta.url)(
  '../electron/verify-outputs.cjs',
);
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-outputs-'));
  const list = listMetadata();
  list.Directives.push(
    { To: 'mods/Example/meshes/test.nif', Size: 4, $type: 'FromArchive' },
    { To: 'paths.txt', Size: 1, $type: 'RemappedInlineFile' },
  );
  const archive = path.join(root, 'list.wabbajack');
  await writeList(archive, list);
  const manifest = {
    game: { id: 'fnv' },
    storage: { installBytes: 10000, downloadBytes: 10000 },
    launch: { profile: 'Fixture' },
    archive: {
      sha256: crypto
        .createHash('sha256')
        .update(fs.readFileSync(archive))
        .digest('hex'),
    },
  };
  for (const item of list.Directives) {
    const target = path.join(root, 'profile', item.To);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.alloc(item.Size, 65));
  }
  fs.writeFileSync(
    path.join(root, 'profile/ModOrganizer.ini'),
    'rewritten paths in ini',
  );
  fs.writeFileSync(
    path.join(root, 'profile/paths.txt'),
    'expanded installation path',
  );
  return { root, manifest, archive, list };
}
test('output verification checks every final file and stable sizes while accepting rewritten config', async () => {
  const h = await fixture();
  const result = await verifyOutputs(h.root, h.manifest, '4.2.3.0');
  assert.equal(result.files, 5);
  assert.equal(result.sizeChecked, 2);
  assert.equal(result.presenceOnly, 3);
  const file = path.join(h.root, 'profile/mods/Example/meshes/test.nif');
  fs.writeFileSync(file, 'bad');
  await assert.rejects(
    verifyOutputs(h.root, h.manifest, '4.2.3.0'),
    /unexpected size/,
  );
  fs.unlinkSync(file);
  await assert.rejects(
    verifyOutputs(h.root, h.manifest, '4.2.3.0'),
    /expected installed file/,
  );
  fs.appendFileSync(h.archive, 'changed');
  await assert.rejects(
    verifyOutputs(h.root, h.manifest, '4.2.3.0'),
    /archive changed/,
  );
});
test('output verification handles consumed BSA inputs, cancellation and redirected folders', async () => {
  const h = await fixture();
  h.list.Directives.push(
    { To: 'TEMP_BSA_FILES/id/mesh.nif', Size: 8, $type: 'FromArchive' },
    { To: 'mods/Example/output.bsa', Size: 8, $type: 'CreateBSA' },
  );
  await writeList(h.archive, h.list);
  h.manifest.archive.sha256 = crypto
    .createHash('sha256')
    .update(fs.readFileSync(h.archive))
    .digest('hex');
  fs.writeFileSync(path.join(h.root, 'profile/mods/Example/output.bsa'), 'bsa');
  const result = await verifyOutputs(h.root, h.manifest, '4.2.3.0');
  assert.equal(result.temporaryInputs, 1);
  assert.equal(result.files, 6);
  await assert.rejects(
    verifyOutputs(h.root, h.manifest, '4.2.3.0', () => true),
    /stopped/,
  );
  const original = path.join(h.root, 'profile/mods/Example/meshes'),
    moved = path.join(h.root, 'moved');
  fs.renameSync(original, moved);
  fs.symlinkSync(moved, original, 'junction');
  await assert.rejects(
    verifyOutputs(h.root, h.manifest, '4.2.3.0'),
    /redirected/,
  );
});

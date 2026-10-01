import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const { Runtime, PIN } = createRequire(import.meta.url)(
  '../electron/runtime.cjs',
);
const archive = process.argv[2];
if (!archive)
  throw new Error(
    'Pass the official pinned release ZIP as the first argument.',
  );
const root = fs.mkdtempSync(
  path.join(os.tmpdir(), 'loadstone-runtime-review-'),
);
const runtime = new Runtime(root);
await runtime.install(path.resolve(archive));
assert.equal(runtime.status().status, 'ready');
assert.equal((await runtime.verify()).status, 'ready');
const inventory = JSON.parse(
  fs.readFileSync(
    path.join(runtime.directory, '.loadstone-inventory.json'),
    'utf8',
  ),
);
const inventoryHash = crypto
  .createHash('sha256')
  .update(JSON.stringify(inventory.files))
  .digest('hex');
fs.appendFileSync(
  path.join(runtime.directory, 'Wabbajack.Installer.dll'),
  'corrupt',
);
assert.equal((await runtime.verify()).status, 'error');
const report = {
  passed: true,
  version: PIN.version,
  archiveHash: PIN.sha256,
  inventoryHash,
  files: inventory.files.length,
  root,
  workflows: [
    'pinned release extraction',
    'actual CLI version and install interface',
    'full file inventory verification',
    'changed-file rejection',
  ],
  verified: new Date().toISOString(),
};
fs.mkdirSync(path.resolve(import.meta.dirname, '..', 'test-results'), {
  recursive: true,
});
fs.writeFileSync(
  path.resolve(
    import.meta.dirname,
    '..',
    'test-results',
    'runtime-verification.json',
  ),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));

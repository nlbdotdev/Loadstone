import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream/promises';
const require = createRequire(import.meta.url);
const { Runtime, extractZip, PIN } = require('../electron/runtime.cjs');
const { ZipFile } = require('yazl');
function folder() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-runtime-test-'));
}
async function archive(root, entries) {
  const zip = new ZipFile();
  for (const entry of entries)
    zip.addBuffer(Buffer.from(entry.content), entry.path, {
      mode: entry.mode || 0o100644,
    });
  zip.end();
  const file = path.join(root, 'test.zip');
  await pipeline(zip.outputStream, fs.createWriteStream(file));
  return file;
}
test('runtime extraction rejects duplicate paths, symbolic links, and cancelled work', async () => {
  for (const entries of [
    [
      { path: 'same.dll', content: 'one' },
      { path: 'SAME.dll', content: 'two' },
    ],
    [{ path: 'outside', content: '../outside', mode: 0o120777 }],
  ]) {
    const root = folder(),
      output = path.join(root, 'output');
    fs.mkdirSync(output);
    const file = await archive(root, entries);
    await assert.rejects(extractZip(file, output), /unsafe or duplicate/);
  }
  const root = folder(),
    output = path.join(root, 'output');
  fs.mkdirSync(output);
  const file = await archive(root, [{ path: 'test.dll', content: 'payload' }]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(extractZip(file, output, controller.signal), {
    name: 'AbortError',
  });
  assert.deepEqual(fs.readdirSync(output), []);
});
test(
  'a failed pinned download cannot replace an existing runtime',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = folder(),
      runtime = new Runtime(root);
    fs.mkdirSync(runtime.directory);
    fs.writeFileSync(
      path.join(runtime.directory, 'preserve.txt'),
      'previous runtime',
    );
    const bad = path.join(root, 'bad.zip');
    fs.writeFileSync(bad, 'invalid archive');
    await assert.rejects(runtime.install(bad), /integrity check/);
    assert.equal(runtime.status().status, 'error');
    assert.equal(
      fs.readFileSync(path.join(runtime.directory, 'preserve.txt'), 'utf8'),
      'previous runtime',
    );
    assert.equal(
      fs.readdirSync(runtime.root).some((name) => name.startsWith('.stage-')),
      false,
    );
  },
);
test(
  'official pinned runtime runs the real CLI and detects changed or injected files',
  { skip: !process.env.LOADSTONE_TEST_RUNTIME_ARCHIVE, timeout: 120000 },
  async () => {
    const root = folder(),
      runtime = new Runtime(root);
    await runtime.install(process.env.LOADSTONE_TEST_RUNTIME_ARCHIVE);
    assert.equal((await runtime.verify()).status, 'ready');
    assert.equal(runtime.status().version, PIN.version);
    await runtime.gameLocations();
    await runtime.gameLocations();
    assert.equal(
      (await runtime.verify()).status,
      'ready',
      'real CLI logs must not invalidate the pinned runtime',
    );
    const injectedLog = path.join(runtime.directory, 'logs', 'payload.dll');
    fs.mkdirSync(path.dirname(injectedLog), { recursive: true });
    fs.writeFileSync(injectedLog, 'not a log');
    assert.equal(
      (await runtime.verify()).status,
      'error',
      'the logs directory is not an integrity exemption',
    );
    fs.unlinkSync(injectedLog);
    assert.equal((await runtime.verify()).status, 'ready');
    const unexpected = path.join(runtime.directory, 'unexpected.dll');
    fs.writeFileSync(unexpected, 'injected');
    assert.equal((await runtime.verify()).status, 'error');
    fs.unlinkSync(unexpected);
    fs.appendFileSync(
      path.join(runtime.directory, 'Wabbajack.Installer.dll'),
      'changed',
    );
    const inventoryFile = path.join(
      runtime.directory,
      '.loadstone-inventory.json',
    );
    const inventory = JSON.parse(fs.readFileSync(inventoryFile, 'utf8'));
    inventory.files = inventory.files.filter(
      (file) => file.path !== 'Wabbajack.Installer.dll',
    );
    fs.writeFileSync(inventoryFile, JSON.stringify(inventory));
    assert.equal(
      (await runtime.verify()).status,
      'error',
      'tampering with the inventory must not authorize altered binaries',
    );
  },
);

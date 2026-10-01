import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sanitizeLogs } = require('../electron/engine-logs.cjs');
function folder() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-log-'));
}
test('log sanitization rejects linked files and redirected log directories without modifying targets', () => {
  const root = folder(),
    outside = folder();
  fs.mkdirSync(path.join(root, 'logs'));
  const target = path.join(outside, 'original.txt');
  fs.writeFileSync(target, 'preserved content');
  fs.linkSync(target, path.join(root, 'logs/wabbajack-cli.current.log'));
  assert.throws(() => sanitizeLogs(root, 'preserved'), /linked/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'preserved content');
  const redirected = folder();
  fs.symlinkSync(outside, path.join(redirected, 'logs'), 'junction');
  assert.throws(() => sanitizeLogs(redirected, 'preserved'), /redirected/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'preserved content');
});
test('numbered CLI logs are sanitized, oversized logs bounded, and unrelated files retained', () => {
  const root = folder(),
    logs = path.join(root, 'logs');
  fs.mkdirSync(logs);
  fs.writeFileSync(path.join(logs, 'wabbajack-cli_1000.log'), 'synthetic-key');
  fs.writeFileSync(
    path.join(logs, 'wabbajack-cli.current.log'),
    Buffer.alloc(10_000_001, 65),
  );
  fs.writeFileSync(path.join(logs, 'other.log'), 'untouched');
  sanitizeLogs(root, 'synthetic-key');
  assert.equal(
    fs.readFileSync(path.join(logs, 'wabbajack-cli_1000.log'), 'utf8'),
    '[redacted]',
  );
  assert.match(
    fs.readFileSync(path.join(logs, 'wabbajack-cli.current.log'), 'utf8'),
    /Oversized engine log omitted/,
  );
  assert.equal(
    fs.readFileSync(path.join(logs, 'other.log'), 'utf8'),
    'untouched',
  );
});

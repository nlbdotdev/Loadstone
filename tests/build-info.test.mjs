import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

test('source archive builds and Windows checkouts retain the same lockfile fingerprint', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'loadstone-build-info-'),
  );
  fs.mkdirSync(path.join(directory, 'dist'));
  const script = path.resolve('scripts/write-build-info.mjs');
  const lockfile = 'lockfileVersion: 9\npackages:\n  fixture: 1\n';
  const expected = crypto.createHash('sha256').update(lockfile).digest('hex');
  for (const bytes of [lockfile, lockfile.replace(/\n/g, '\r\n')]) {
    fs.writeFileSync(path.join(directory, 'pnpm-lock.yaml'), bytes);
    execFileSync(process.execPath, [script], {
      cwd: directory,
      windowsHide: true,
    });
    const build = JSON.parse(
      fs.readFileSync(path.join(directory, 'dist/build-info.json'), 'utf8'),
    );
    assert.equal(build.lockfileSha256, expected);
    assert.equal(
      build.commit,
      null,
      'a source ZIP must not invent a Git commit',
    );
    assert.equal(build.dirty, null);
  }
  fs.writeFileSync(
    path.join(directory, 'pnpm-lock.yaml'),
    lockfile.replace('fixture: 1', 'fixture: 2'),
  );
  execFileSync(process.execPath, [script], {
    cwd: directory,
    windowsHide: true,
  });
  const changed = JSON.parse(
    fs.readFileSync(path.join(directory, 'dist/build-info.json'), 'utf8'),
  );
  assert.notEqual(
    changed.lockfileSha256,
    expected,
    'dependency changes must change the fingerprint',
  );
});

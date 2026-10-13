import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { replaceStateFile } = require('../electron/replace-state-file.cjs');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-replace-'));
  const from = path.join(root, 'state.tmp'),
    to = path.join(root, 'state.json');
  fs.writeFileSync(from, 'new');
  fs.writeFileSync(to, 'old');
  return { from, to };
}
test('transient Windows locks retry atomic replacement without exposing partial state', () => {
  const { from, to } = fixture();
  let attempts = 0;
  const waits = [];
  replaceStateFile(from, to, {
    platform: 'win32',
    sleep: (ms) => waits.push(ms),
    rename: (a, b) => {
      assert.equal(fs.readFileSync(to, 'utf8'), 'old');
      if (attempts++ < 2)
        throw Object.assign(new Error('locked'), { code: 'EPERM' });
      fs.renameSync(a, b);
    },
  });
  assert.equal(fs.readFileSync(to, 'utf8'), 'new');
  assert.equal(fs.existsSync(from), false);
  assert.deepEqual(waits, [10, 20]);
});
test('persistent locks are bounded; other errors fail immediately and leave both files intact', () => {
  for (const [platform, code, expected] of [
    ['win32', 'EACCES', 6],
    ['win32', 'ENOSPC', 1],
    ['linux', 'EPERM', 1],
  ]) {
    const { from, to } = fixture();
    let attempts = 0,
      wait = 0;
    assert.throws(
      () =>
        replaceStateFile(from, to, {
          platform,
          sleep: (ms) => (wait += ms),
          rename: () => {
            attempts++;
            throw Object.assign(new Error('failure'), { code });
          },
        }),
      /failure/,
    );
    assert.equal(attempts, expected);
    assert.equal(wait, expected === 6 ? 310 : 0);
    assert.equal(fs.readFileSync(to, 'utf8'), 'old');
    assert.equal(fs.readFileSync(from, 'utf8'), 'new');
  }
});

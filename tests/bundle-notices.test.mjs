import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { bundleNotices } from '../scripts/bundle-notices.mjs';

test('built renderer retains original notices for bundled frontend code without local paths', () => {
  const raw = fs.readFileSync('dist/frontend-notices.json', 'utf8');
  const frontend = JSON.parse(raw);
  const shipped = JSON.parse(
    fs.readFileSync('notices/dependencies.json', 'utf8'),
  );
  for (const name of ['svelte', '@lucide/svelte', 'vite'])
    assert.ok(frontend.packages.some((item) => item.name === name));
  for (const name of ['is-reference', 'locate-character'])
    assert.ok(!frontend.packages.some((item) => item.name === name));
  assert.ok(!raw.includes(process.cwd()));
  assert.ok(!raw.includes(process.cwd().replaceAll('\\', '/')));
  for (const dependency of frontend.packages) {
    assert.ok(dependency.renderedModules > 0);
    assert.ok(dependency.notices.length > 0, dependency.name);
    const record = shipped.packages.find(
      (item) =>
        item.name === dependency.name && item.version === dependency.version,
    );
    assert.ok(record?.scopes.includes('renderer-bundle'), dependency.name);
    for (const notice of dependency.notices)
      assert.ok(
        record.notices.some(
          (item) =>
            item.file === notice.name &&
            item.sha256 ===
              crypto.createHash('sha256').update(notice.text).digest('hex'),
        ),
        dependency.name,
      );
  }
});

test('generated runtime code cannot silently bypass attribution', () => {
  assert.throws(
    () =>
      bundleNotices().generateBundle.call(
        { emitFile() {} },
        {},
        {
          main: {
            type: 'chunk',
            modules: { ['\0unreviewed-helper']: { renderedLength: 20 } },
          },
        },
      ),
    /Unattributed generated/,
  );
});

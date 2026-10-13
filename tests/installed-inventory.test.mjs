import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { inspectMo2 } = require('../electron/installed-inventory.cjs');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-inventory-'));
  for (const dir of [
    'profiles/Actual profile',
    'mods/High',
    'mods/Low',
    'Game/Data',
    'overwrite',
  ])
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  const write = (file, text) => fs.writeFileSync(path.join(root, file), text);
  write(
    'ModOrganizer.ini',
    '[General]\ngameName=TTW\nselected_profile=@ByteArray(Actual profile)\ngamePath=Game\n',
  );
  write(
    'profiles/Actual profile/modlist.txt',
    '# MO2\n+High\n+Low\n-Inactive\n-Section_separator\n',
  );
  write(
    'profiles/Actual profile/plugins.txt',
    '# MO2\nFalloutNV.esm\nTest.esp\n',
  );
  write('mods/High/Test.esp', 'modified installed plugin');
  write('mods/Low/Test.esp', 'original plugin');
  write(
    'mods/High/meta.ini',
    '[General]\nmodid=123\nversion=1.2\napiKey=synthetic-do-not-export\n',
  );
  write('Game/Data/FalloutNV.esm', 'game master');
  return { root, write };
}
test('inventory preserves actual priority, hashes installed plugin winners and excludes unapproved metadata', async () => {
  const f = fixture();
  const before = fs.readFileSync(path.join(f.root, 'ModOrganizer.ini'));
  const report = await inspectMo2(f.root, { hashFiles: true });
  assert.equal(report.source.profile, 'Actual profile');
  assert.equal(report.plugins[1].winner, 'High');
  assert.deepEqual(report.plugins[1].shadowed, ['Low']);
  assert.equal(
    report.plugins[1].sha256,
    crypto
      .createHash('sha256')
      .update('modified installed plugin')
      .digest('hex'),
  );
  assert.equal(report.summary.enabledMods, 2);
  assert.deepEqual(report.summary.missingPlugins, []);
  assert.equal(report.mods[0].files[0].sha256.length, 64);
  assert.equal(
    JSON.stringify(report).includes('synthetic-do-not-export'),
    false,
  );
  assert.equal(report.installable, false);
  assert.equal(report.publicationApproved, false);
  assert.deepEqual(
    fs.readFileSync(path.join(f.root, 'ModOrganizer.ini')),
    before,
  );
  f.write('overwrite/Test.esp', 'generated override');
  assert.equal((await inspectMo2(f.root)).plugins[1].winner, 'overwrite');
});
test('inventory reports missing active content and rejects traversal, duplicate records and redirected trees', async () => {
  const f = fixture();
  f.write('profiles/Actual profile/modlist.txt', '+Absent\n');
  const report = await inspectMo2(f.root);
  assert.deepEqual(report.summary.missingMods, ['Absent']);
  assert.deepEqual(report.summary.missingPlugins, ['Test.esp']);
  f.write('profiles/Actual profile/modlist.txt', '+../outside\n');
  await assert.rejects(inspectMo2(f.root), /Unsafe/);
  f.write('profiles/Actual profile/modlist.txt', '+High\n+high\n');
  await assert.rejects(inspectMo2(f.root), /Duplicate/);
  f.write('profiles/Actual profile/modlist.txt', '+High\n');
  fs.symlinkSync(
    path.join(f.root, 'Game'),
    path.join(f.root, 'mods/High/redirect'),
    'junction',
  );
  await assert.rejects(inspectMo2(f.root), /redirected/);
});
test('inventory refuses a profile changed during inspection', async () => {
  const f = fixture();
  let changed = false;
  await assert.rejects(
    inspectMo2(f.root, {
      progress: () => {
        if (!changed) {
          changed = true;
          f.write('profiles/Actual profile/modlist.txt', '+High\n');
        }
      },
    }),
    /Profile changed/,
  );
});

test('CLI refuses to write a report into the inspected installation', async () => {
  const { spawnSync } = await import('node:child_process');
  const f = fixture(),
    output = path.join(f.root, 'inventory.json');
  const result = spawnSync(
    process.execPath,
    [path.resolve('scripts/inspect-mo2.mjs'), f.root, output],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /outside the inspected instance/);
  assert.equal(fs.existsSync(output), false);
});

test('configured external MO2 folders determine winners and are protected from report writes', async () => {
  const { spawnSync } = await import('node:child_process');
  const f = fixture();
  const external = fs.mkdtempSync(
    path.join(os.tmpdir(), 'loadstone-external-'),
  );
  for (const name of ['mods', 'profiles', 'overwrite']) {
    fs.cpSync(path.join(f.root, name), path.join(external, name), {
      recursive: true,
    });
  }
  f.write(
    'ModOrganizer.ini',
    `[General]\ngameName=TTW\nselected_profile=Actual profile\ngamePath=Game\n[Settings]\nbase_directory=${external.replaceAll('\\', '/')}\nmods_directory=%BASE_DIR%/mods\nprofiles_directory=%BASE_DIR%/profiles\noverwrite_directory=%BASE_DIR%/overwrite\n`,
  );
  fs.writeFileSync(
    path.join(external, 'overwrite/Test.esp'),
    'external winner',
  );
  const report = await inspectMo2(f.root, { hashFiles: true });
  assert.equal(report.plugins[1].winner, 'overwrite');
  assert.equal(
    report.overwrite[0].sha256,
    crypto.createHash('sha256').update('external winner').digest('hex'),
  );
  for (const folder of ['mods', 'profiles', 'overwrite']) {
    const output = path.join(external, folder, 'inventory.json');
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/inspect-mo2.mjs'), f.root, output],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /outside source game\/mod\/profile directories/,
    );
    assert.equal(fs.existsSync(output), false);
  }
});

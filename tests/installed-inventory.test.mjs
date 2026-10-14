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
    '[General]\ngameName=TTW\nselected_profile=@ByteArray(Actual profile)\ngamePath=Game\nwindow_state=@ByteArray(\\xff)\n',
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
    `[General]\ngameName=TTW\nselected_profile=Actual profile\ngamePath=Game\n[Settings]\nbase_directory=${external.replaceAll('\\', '/')}\nmod_directory=%BASE_DIR%/custom-mods\nprofiles_directory=%BASE_DIR%/profiles\noverwrite_directory=%BASE_DIR%/overwrite\n`,
  );
  fs.cpSync(path.join(external, 'mods'), path.join(external, 'custom-mods'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(external, 'custom-mods/High/Test.esp'),
    'custom mod bytes',
  );
  fs.writeFileSync(
    path.join(external, 'overwrite/Test.esp'),
    'external winner',
  );
  const report = await inspectMo2(f.root, { hashFiles: true });
  assert.equal(report.source.modsFolder, path.join(external, 'custom-mods'));
  assert.equal(report.plugins[1].winner, 'overwrite');
  assert.equal(
    report.overwrite[0].sha256,
    crypto.createHash('sha256').update('external winner').digest('hex'),
  );
  for (const folder of ['custom-mods', 'profiles', 'overwrite']) {
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

test('expanded inventory hashes disabled mods, game/tool files and full selected profile while excluding personal state', async () => {
  const f = fixture();
  for (const folder of [
    'mods/Inactive',
    'dlls',
    'downloads',
    'webcache',
    'profiles/Actual profile/saves_backup_old',
    'mods/High/saves',
    'logs',
  ])
    fs.mkdirSync(path.join(f.root, folder), { recursive: true });
  const expected = new Map([
    ['mods/Inactive/Optional.esp', 'inactive installed bytes'],
    ['dlls/fixture.dll', 'tool library'],
    ['ModOrganizer.exe', 'tool executable'],
    ['Game/FalloutNV.exe', 'patched game executable'],
    ['profiles/Actual profile/FalloutCustom.ini', 'custom profile settings'],
    ['profiles/Actual profile/lockedorder.txt', 'locked load order'],
    ['dlls/Token.py', 'parser source, not a credential store'],
    ['dlls/wizard.tokens', 'parser token definitions'],
    ['dlls/Token.cpython-312.opt-2.pyc', 'compiled parser source'],
    ['dlls/cookies.py', 'cookie parser implementation'],
    ['dlls/credentials.py', 'credential parser implementation'],
  ]);
  for (const [file, data] of expected) f.write(file, data);
  const forbidden = [
    'downloads/archive.7z',
    'downloads/_nexus_headers.txt',
    'webcache/Cookies',
    'profiles/Actual profile/saves_backup_old/slot.fos',
    'mods/High/saves/slot.fos',
    'api-key.txt',
    '.env.local',
    'tokens.json',
    'logs/game.txt',
    'Game/session.log',
  ];
  for (const file of forbidden) f.write(file, 'synthetic-private-state');
  const originalStream = fs.createReadStream;
  fs.createReadStream = (file, ...args) => {
    assert.equal(
      forbidden.some((v) => path.resolve(file) === path.join(f.root, v)),
      false,
      'Excluded file was opened',
    );
    return originalStream(file, ...args);
  };
  let report;
  try {
    report = await inspectMo2(f.root, {
      hashFiles: true,
      installationFiles: true,
    });
  } finally {
    fs.createReadStream = originalStream;
  }
  const actual = new Map([
    ...report.installation.instanceFiles.map((v) => [v.path, v.sha256]),
    ...report.installation.gameFiles.map((v) => [`Game/${v.path}`, v.sha256]),
    ...report.installation.profileFiles.map((v) => [
      `profiles/Actual profile/${v.path}`,
      v.sha256,
    ]),
    ...report.mods.flatMap((mod) =>
      (mod.files || []).map((v) => [`mods/${mod.name}/${v.path}`, v.sha256]),
    ),
  ]);
  for (const [file, data] of expected)
    assert.equal(
      actual.get(file),
      crypto.createHash('sha256').update(data).digest('hex'),
    );
  assert.equal(report.mods.find((v) => v.name === 'Inactive').enabled, false);
  assert.equal(report.summary.inventoriedDisabledModFiles, 1);
  assert.equal(
    report.installation.instanceFiles.some((v) =>
      /^(mods|profiles|Game|downloads)\//i.test(v.path),
    ),
    false,
  );
  assert.ok(
    report.exclusions.some(
      (v) =>
        v.scope === 'profile' &&
        v.path === 'saves_backup_old' &&
        v.reason === 'saved-game-state',
    ),
  );
  assert.ok(
    report.exclusions.some(
      (v) =>
        v.path === 'tokens.json' && v.reason === 'credential-or-browser-state',
    ),
  );
  assert.equal(
    JSON.stringify(report).includes('synthetic-private-state'),
    false,
  );
  for (const file of forbidden)
    assert.equal(
      fs.readFileSync(path.join(f.root, file), 'utf8'),
      'synthetic-private-state',
    );
  const ordinaryReport = await inspectMo2(f.root);
  assert.equal(ordinaryReport.installation, undefined);
  assert.equal(
    ordinaryReport.mods.find((v) => v.name === 'Inactive').files,
    undefined,
  );
});

test('instance inventory excludes regenerable Python plugin caches while retaining sources and bytecode-only content', async () => {
  const f = fixture();
  for (const folder of ['plugins/example/__pycache__', 'mods/High/__pycache__'])
    fs.mkdirSync(path.join(f.root, folder), { recursive: true });
  const caches = [
    'plugins/example/__pycache__/tool.cpython-312.opt-2.pyc',
    'plugins/example/__pycache__/tool.cpython-312.pyc',
  ];
  const included = [
    'plugins/example/tool.py',
    'plugins/example/standalone.pyc',
    'plugins/example/__pycache__/orphan.cpython-312.pyc',
    'plugins/example/__pycache__/tool.pypy-312.pyc',
    'plugins/example/__pycache__/payload.dat',
    'mods/High/tool.py',
    'mods/High/__pycache__/tool.cpython-312.pyc',
  ];
  for (const file of [...caches, ...included])
    f.write(file, `fixture: ${file}`);
  const stream = fs.createReadStream;
  fs.createReadStream = (file, ...args) => {
    assert.equal(
      caches.some((v) => path.resolve(file) === path.join(f.root, v)),
      false,
    );
    return stream(file, ...args);
  };
  let report;
  try {
    report = await inspectMo2(f.root, {
      hashFiles: true,
      installationFiles: true,
    });
  } finally {
    fs.createReadStream = stream;
  }
  const paths = [
    ...report.installation.instanceFiles.map((v) => v.path),
    ...report.mods.flatMap((mod) =>
      (mod.files || []).map((v) => `mods/${mod.name}/${v.path}`),
    ),
  ];
  for (const file of included) assert.ok(paths.includes(file), file);
  for (const file of caches) {
    assert.equal(paths.includes(file), false);
    assert.ok(
      report.exclusions.some(
        (v) =>
          v.scope === 'instance' &&
          v.path === file &&
          v.reason === 'regenerable-python-bytecode',
      ),
    );
    assert.equal(
      fs.readFileSync(path.join(f.root, file), 'utf8'),
      `fixture: ${file}`,
    );
  }
  await assert.rejects(
    inspectMo2(f.root, {
      hashFiles: true,
      installationFiles: true,
      progress(value) {
        if (value.phase === 'stability')
          f.write('plugins/example/tool.py', 'changed source');
      },
    }),
    /changed/,
  );
});

test('final inventory guards reject added, removed and changed files or replaced trees', async () => {
  for (const mutation of ['added', 'removed', 'changed', 'replaced']) {
    const f = fixture();
    fs.mkdirSync(path.join(f.root, 'dlls'));
    fs.mkdirSync(path.join(f.root, 'backups'));
    let mutated = false;
    await assert.rejects(
      inspectMo2(f.root, {
        hashFiles: true,
        installationFiles: true,
        progress(value) {
          if (value.phase !== 'stability' || mutated) return;
          mutated = true;
          if (mutation === 'added') f.write('mods/High/Added.esp', 'new file');
          if (mutation === 'removed')
            fs.unlinkSync(path.join(f.root, 'mods/High/Test.esp'));
          if (mutation === 'changed')
            f.write('mods/High/Test.esp', 'changed after hashing');
          if (mutation === 'replaced') {
            fs.renameSync(
              path.join(f.root, 'dlls'),
              path.join(f.root, 'backups/dlls'),
            );
            fs.mkdirSync(path.join(f.root, 'dlls'));
          }
        },
      }),
      /changed|ENOENT/,
    );
    assert.equal(mutated, true);
  }
});

test('expanded inventory supports cancellation and protects configured download folders from report output', async () => {
  const f = fixture();
  const external = fs.mkdtempSync(
    path.join(os.tmpdir(), 'loadstone-download-input-'),
  );
  f.write(
    'ModOrganizer.ini',
    `[General]\ngameName=TTW\nselected_profile=Actual profile\ngamePath=Game\n[Settings]\ndownload_directory=${external.replaceAll('\\', '/')}\n`,
  );
  const controller = new AbortController();
  await assert.rejects(
    inspectMo2(f.root, {
      installationFiles: true,
      signal: controller.signal,
      progress(value) {
        if (value.phase === 'stability') controller.abort();
      },
    }),
    { name: 'AbortError' },
  );
  const { spawnSync } = await import('node:child_process');
  const target = path.join(external, 'report.json');
  const result = spawnSync(
    process.execPath,
    [
      path.resolve('scripts/inspect-mo2.mjs'),
      f.root,
      target,
      '--installation-files',
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(target), false);
});

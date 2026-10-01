import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Launcher, launchPlan } = require('../electron/launcher.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-launch-'));
  const output = path.join(root, 'profile');
  const job = {
    id: 'test-id',
    setupId: 'setup',
    status: 'installed',
    destination: root,
    gameFolder: root,
    manifest: {
      launch: { profile: 'Test profile', executable: 'Game & tools' },
    },
  };
  fs.mkdirSync(path.join(output, 'profiles', 'Test profile'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, '.loadstone-owner.json'),
    JSON.stringify({ jobId: job.id, setupId: job.setupId }),
  );
  fs.writeFileSync(path.join(output, 'ModOrganizer.exe'), 'MZfixture');
  fs.writeFileSync(path.join(output, 'game.exe'), 'MZfixture');
  fs.writeFileSync(path.join(output, 'portable.txt'), '');
  fs.writeFileSync(
    path.join(output, 'profiles', 'Test profile', 'modlist.txt'),
    '#fixture',
  );
  fs.writeFileSync(
    path.join(output, 'ModOrganizer.ini'),
    '[customExecutables]\n1\\title=Game & tools\n1\\binary=game.exe\n',
  );
  return { root, output, job, installer: { jobs: [job], list: () => [job] } };
}
async function closed(launcher) {
  for (let n = 0; n < 100 && launcher.sessions.get('test-id')?.child; n++)
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(launcher.sessions.get('test-id').child, null);
}
test('live launch uses the exact profile and executable as arguments and tracks only the manager', async () => {
  const h = fixture();
  let launched;
  const launcher = new Launcher(h.installer, {
    spawn: (file, args, options) => {
      assert.equal(file, path.join(h.output, 'ModOrganizer.exe'));
      assert.deepEqual(args, [
        '-p',
        'Test profile',
        'run',
        '-e',
        'Game & tools',
      ]);
      assert.equal(options.cwd, h.output);
      assert.equal(options.shell, false);
      assert.equal(options.env.NEXUS_API_KEY, undefined);
      assert.equal(options.env.NEXUS_OAUTH_INFO, undefined);
      launched = spawn(
        process.execPath,
        ['-e', 'setTimeout(() => process.exit(0), 300)'],
        options,
      );
      return launched;
    },
  });
  try {
    await launcher.launch(h.job.id);
    assert.equal(launcher.list()[0].launch.phase, 'open');
    await assert.rejects(launcher.launch(h.job.id), /still open/);
    await closed(launcher);
    assert.equal(launcher.list()[0].launch.phase, 'closed');
    assert.equal(h.job.status, 'installed');
  } finally {
    if (launched?.exitCode === null) launched.kill();
  }
});
test('launch refuses incomplete, redirected, missing-marker and missing-target profiles', () => {
  const h = fixture();
  assert.throws(() => launchPlan({ ...h.job, status: 'failed' }), /completed/);
  fs.unlinkSync(path.join(h.output, 'portable.txt'));
  assert.throws(() => launchPlan(h.job), /portable.txt/);
  fs.writeFileSync(path.join(h.output, 'portable.txt'), '');
  const iniFile = path.join(h.output, 'ModOrganizer.ini');
  const originalIni = fs.readFileSync(iniFile, 'utf8');
  fs.appendFileSync(
    iniFile,
    '[Settings]\nprofiles_directory=../other-profiles\n',
  );
  assert.throws(() => launchPlan(h.job), /different profile directory/);
  fs.writeFileSync(
    iniFile,
    originalIni + '[Settings]\nprofiles_directory=%BASE_DIR%/profiles\n',
  );
  assert.equal(launchPlan(h.job).cwd, h.output);
  fs.unlinkSync(path.join(h.output, 'game.exe'));
  assert.throws(() => launchPlan(h.job));
  fs.writeFileSync(path.join(h.output, 'game.exe'), 'MZfixture');
  fs.writeFileSync(path.join(h.root, '.loadstone-owner.json'), '{}');
  assert.throws(() => launchPlan(h.job), /not owned/);
});
test('spawn failure and nonzero manager exit remain visible and allow retry', async () => {
  const h = fixture();
  let failSpawn = true;
  const launcher = new Launcher(h.installer, {
    spawn: (_file, _args, options) =>
      failSpawn
        ? spawn(path.join(h.root, 'missing.exe'), [], options)
        : spawn(process.execPath, ['-e', 'process.exit(3)'], options),
  });
  await assert.rejects(launcher.launch(h.job.id), /could not start/);
  assert.equal(launcher.list()[0].launch.phase, 'error');
  failSpawn = false;
  await launcher.launch(h.job.id);
  await closed(launcher);
  assert.match(launcher.list()[0].launch.message, /code 3/);
});

test('isolated game layout checks MO2 gamePath, launch target and redirects before launch', async () => {
  const h = fixture(),
    stock = path.join(h.output, 'Stock Game'),
    iniFile = path.join(h.output, 'ModOrganizer.ini');
  h.job.manifest.game = { id: 'fnv' };
  h.job.manifest.launch.gameRoot = 'Stock Game';
  fs.mkdirSync(stock);
  fs.writeFileSync(path.join(stock, 'FalloutNV.exe'), 'MZfixture');
  const ini =
    '[General]\ngamePath=@ByteArray(' +
    stock.replaceAll('\\', '\\\\') +
    ')\n[customExecutables]\n1\\title=Game & tools\n1\\binary=' +
    path.join(stock, 'FalloutNV.exe').replaceAll('\\', '/') +
    '\n';
  fs.writeFileSync(iniFile, ini);
  assert.ok(launchPlan(h.job));
  for (const changed of [
    ini.replace(
      stock.replaceAll('\\', '\\\\'),
      h.root.replaceAll('\\', '\\\\'),
    ),
    ini.replace(
      path.join(stock, 'FalloutNV.exe').replaceAll('\\', '/'),
      'game.exe',
    ),
    ini.replace('[General]', '[Ignored]'),
    ini.replace('[General]', '[General]\ngamePath=other'),
  ]) {
    fs.writeFileSync(iniFile, changed);
    const launcher = new Launcher(h.installer, {
      spawn: () => assert.fail('An invalid layout must never launch'),
    });
    await assert.rejects(
      launcher.launch(h.job.id),
      /gamePath|different game folder|outside the isolated/,
    );
  }
  fs.writeFileSync(iniFile, ini);
  const moved = path.join(h.root, 'moved-game');
  fs.renameSync(stock, moved);
  fs.symlinkSync(moved, stock, 'junction');
  assert.throws(() => launchPlan(h.job), /missing or redirected/);
});

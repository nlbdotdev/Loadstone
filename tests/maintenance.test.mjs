import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Installer } = require('../electron/installer.cjs');
const { Maintenance, recoveryPath } = require('../electron/maintenance.cjs');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-removal-'));
  const state = path.join(root, 'state'),
    destination = path.join(root, 'setup'),
    game = path.join(root, 'game');
  for (const folder of [state, destination, game]) fs.mkdirSync(folder);
  const manifest = {
    schemaVersion: 1,
    id: 'fixture',
    name: 'Fixture',
    version: '1',
    description: 'Fixture',
    author: 'Tests',
    website: 'https://example.com',
    game: {
      id: 'fnv',
      versions: ['test'],
      executableHashes: ['0'.repeat(64)],
      requiredFiles: [],
    },
    storage: { installBytes: 1024, downloadBytes: 1024 },
    archive: {
      file: 'test.wabbajack',
      sha256: '0'.repeat(64),
      source: 'https://example.com',
    },
    launch: { manager: 'mo2', profile: 'Test', executable: 'Test' },
    credits: [
      {
        name: 'Fixture',
        author: 'Tests',
        source: 'https://example.com',
        license: 'Test fixture',
      },
    ],
  };
  const job = {
    id: crypto.randomUUID(),
    setupId: manifest.id,
    name: manifest.name,
    status: 'installed',
    destination,
    gameFolder: game,
    manifest,
    logs: [],
    error: null,
  };
  fs.writeFileSync(
    path.join(destination, '.loadstone-owner.json'),
    JSON.stringify({ jobId: job.id, setupId: job.setupId }),
  );
  const keep = [
    'profile/profiles/Test/saves/save.fos',
    'profile/profiles/Test/modlist.txt',
    'profile/overwrite/custom.txt',
    'profile/ModOrganizer.ini',
    'profile/custom/Saves/unusual.sav',
    'downloads/archive.zip',
    'custom-root.txt',
  ];
  const remove = [
    'profile/ModOrganizer.exe',
    'profile/mods/Example/mod.esp',
    'profile/tools/tool.exe',
  ];
  for (const file of [...keep, ...remove]) {
    fs.mkdirSync(path.dirname(path.join(destination, file)), {
      recursive: true,
    });
    fs.writeFileSync(path.join(destination, file), 'original:' + file);
  }
  fs.writeFileSync(path.join(game, 'global-save.fos'), 'untouched');
  const installer = new Installer(state, {}, {}, {});
  installer.jobs = [job];
  installer.save(installer.jobs);
  return { root, state, destination, game, job, installer, keep, remove };
}
test('removal frees installed files while retaining profiles, local saves, downloads and outside game files', async () => {
  const h = fixture(),
    maintenance = new Maintenance(h.installer, { idle: async () => {} });
  const preview = await maintenance.preview(h.job.id);
  assert.equal(preview.files, h.remove.length);
  assert.ok(preview.bytes > 0);
  assert.ok(fs.existsSync(h.destination));
  await maintenance.remove(h.job.id);
  const recovery = recoveryPath(h.job);
  assert.equal(fs.existsSync(h.destination), false);
  for (const file of h.keep)
    assert.equal(
      fs.readFileSync(path.join(recovery, file), 'utf8'),
      'original:' + file,
    );
  for (const file of h.remove)
    assert.equal(fs.existsSync(path.join(recovery, file)), false);
  assert.equal(
    fs.readFileSync(path.join(h.game, 'global-save.fos'), 'utf8'),
    'untouched',
  );
  assert.equal(new Installer(h.state, {}, {}, {}).jobs[0].status, 'removed');
});
test('failed cleanup and crash state resume without deleting preserved data', async () => {
  const h = fixture();
  let calls = 0;
  const maintenance = new Maintenance(h.installer, {
    idle: async () => {},
    unlink: async (file) => {
      if (++calls === 2) throw new Error('Simulated locked file');
      await fs.promises.unlink(file);
    },
  });
  await assert.rejects(maintenance.remove(h.job.id), /locked file/);
  assert.equal(h.installer.jobs[0].status, 'removal-failed');
  h.installer.change(h.job.id, { status: 'removing' });
  const restarted = new Installer(h.state, {}, {}, {});
  assert.equal(restarted.jobs[0].status, 'removal-failed');
  await new Maintenance(restarted, { idle: async () => {} }).remove(h.job.id);
  for (const file of h.keep)
    assert.equal(
      fs.readFileSync(path.join(recoveryPath(h.job), file), 'utf8'),
      'original:' + file,
    );
  assert.equal(restarted.jobs[0].status, 'removed');
});
test('removal rejects active processes, foreign ownership, redirects and game overlap before moving files', async () => {
  const h = fixture();
  await assert.rejects(
    new Maintenance(h.installer, {
      idle: async () => {
        throw new Error('Close game');
      },
    }).remove(h.job.id),
    /Close game/,
  );
  const maintenance = new Maintenance(h.installer, { idle: async () => {} });
  h.installer.maintenance = true;
  await assert.rejects(maintenance.remove(h.job.id), /Another/);
  h.installer.maintenance = false;
  const link = path.join(h.destination, 'profile', 'external');
  fs.symlinkSync(
    h.game,
    link,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(maintenance.remove(h.job.id), /redirected/);
  fs.unlinkSync(link);
  h.installer.jobs[0].gameFolder = h.destination;
  await assert.rejects(maintenance.remove(h.job.id), /overlaps/);
  h.installer.jobs[0].gameFolder = h.game;
  fs.writeFileSync(path.join(h.destination, '.loadstone-owner.json'), '{}');
  await assert.rejects(maintenance.remove(h.job.id), /not owned/);
  assert.ok(
    fs.existsSync(path.join(h.destination, 'profile/ModOrganizer.exe')),
  );
});

test('a failed state save prevents removal and an interruption before the move can resume', async () => {
  const h = fixture(),
    maintenance = new Maintenance(h.installer, { idle: async () => {} });
  const save = h.installer.save.bind(h.installer);
  h.installer.save = () => {
    throw new Error('Disk full');
  };
  await assert.rejects(maintenance.remove(h.job.id), /Disk full/);
  assert.equal(fs.existsSync(recoveryPath(h.job)), false);
  for (const file of h.remove)
    assert.ok(fs.existsSync(path.join(h.destination, file)));
  h.installer.save = save;
  h.installer.change(h.job.id, { status: 'removing' });
  const restarted = new Installer(h.state, {}, {}, {});
  await new Maintenance(restarted, { idle: async () => {} }).remove(h.job.id);
  assert.equal(restarted.jobs[0].status, 'removed');
  for (const file of h.keep)
    assert.ok(fs.existsSync(path.join(recoveryPath(h.job), file)));
});

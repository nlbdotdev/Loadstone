import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SteamShortcuts, crc32 } = require('../electron/steam-shortcuts.cjs');
const { decode, encode, field } = require('../electron/steam-vdf.cjs');
function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'loadstone-steam-shortcuts-'),
  );
  const config = path.join(root, 'userdata', '1234', 'config');
  const destination = path.join(root, 'setup'),
    output = path.join(destination, 'profile');
  fs.mkdirSync(config, { recursive: true });
  fs.mkdirSync(path.join(output, 'profiles', 'Test'), { recursive: true });
  const job = {
    id: crypto.randomUUID(),
    setupId: 'test',
    name: 'Test game',
    status: 'installed',
    destination,
    gameFolder: destination,
    manifest: {
      version: '1.0',
      launch: { profile: 'Test', executable: 'Game' },
    },
  };
  fs.writeFileSync(
    path.join(destination, '.loadstone-owner.json'),
    JSON.stringify({ jobId: job.id, setupId: job.setupId }),
  );
  fs.writeFileSync(path.join(output, 'ModOrganizer.exe'), 'MZfixture');
  fs.writeFileSync(path.join(output, 'game.exe'), 'MZfixture');
  fs.writeFileSync(path.join(output, 'portable.txt'), '');
  fs.writeFileSync(
    path.join(output, 'profiles', 'Test', 'modlist.txt'),
    '#fixture',
  );
  fs.writeFileSync(
    path.join(output, 'ModOrganizer.ini'),
    '[customExecutables]\n1\\title=Game\n1\\binary=game.exe\n',
  );
  const service = new SteamShortcuts({
    roots: async () => [root],
    closed: async () => {},
  });
  return {
    root,
    config,
    file: path.join(config, 'shortcuts.vdf'),
    job,
    service,
  };
}
const shortcutFile = (entries) =>
  encode([{ type: 0, key: 'shortcuts', value: entries }]);
const unrelated = {
  type: 0,
  key: '0',
  value: [
    { type: 2, key: 'appid', value: 123 },
    { type: 1, key: 'AppName', value: 'Other game' },
    { type: 1, key: 'LaunchOptions', value: '--preserve "custom"' },
    {
      type: 0,
      key: 'tags',
      value: [{ type: 1, key: '0', value: 'Favorites' }],
    },
  ],
};
test('Steam shortcut create and repair preserve unrelated raw entries, owned app IDs, and backups', async () => {
  const h = fixture(),
    original = shortcutFile([unrelated]);
  fs.writeFileSync(h.file, original);
  const [account] = await h.service.list();
  assert.equal(account.folder, undefined);
  const result = await h.service.create(h.job, account.id);
  assert.deepEqual(fs.readFileSync(result.backup), original);
  const first = decode(fs.readFileSync(h.file))[0].value;
  assert.deepEqual(first[0].raw, decode(original)[0].value[0].raw);
  assert.equal(
    field(first[1].value, 'LaunchOptions').value,
    '"-p" "Test" "run" "-e" "Game"',
  );
  const appid = field(first[1].value, 'appid').value;
  assert.ok(appid >= 0x80000000);
  h.job.name = 'Renamed setup';
  await h.service.create(h.job, account.id);
  const second = decode(fs.readFileSync(h.file))[0].value;
  assert.equal(second.length, 2);
  assert.equal(field(second[1].value, 'appid').value, appid);
  assert.deepEqual(second[0].raw, first[0].raw);
  assert.equal(crc32('123456789'), 0xcbf43926);
});
test('Steam shortcut edits reject running Steam, changed files, malformed files and unrelated name collisions', async () => {
  const h = fixture(),
    [account] = await h.service.list();
  h.service.closed = async () => {
    throw new Error('Exit Steam');
  };
  await assert.rejects(h.service.create(h.job, account.id), /Exit Steam/);
  assert.equal(fs.existsSync(h.file), false);
  h.service.closed = async () => {};
  fs.writeFileSync(h.file, 'broken');
  await assert.rejects(h.service.create(h.job, account.id));
  assert.equal(fs.readFileSync(h.file, 'utf8'), 'broken');
  fs.writeFileSync(h.file, shortcutFile([unrelated]));
  let checks = 0;
  h.service.closed = async () => {
    if (++checks === 2) fs.writeFileSync(h.file, 'concurrent edit');
  };
  await assert.rejects(
    h.service.create(h.job, account.id),
    /changed during preparation/,
  );
  assert.equal(fs.readFileSync(h.file, 'utf8'), 'concurrent edit');
  h.service.closed = async () => {};
  fs.writeFileSync(
    h.file,
    shortcutFile([
      {
        type: 0,
        key: '0',
        value: [
          {
            type: 1,
            key: 'AppName',
            value: h.job.name + ' ' + h.job.manifest.version + ' — Loadstone',
          },
        ],
      },
    ]),
  );
  const collision = fs.readFileSync(h.file);
  await assert.rejects(
    h.service.create(h.job, account.id),
    /unrelated Steam entry/,
  );
  assert.deepEqual(fs.readFileSync(h.file), collision);
});
test('binary VDF rejects truncation, duplicate keys, unsupported types and trailing data', () => {
  const valid = shortcutFile([unrelated]);
  assert.deepEqual(encode(decode(valid)), valid);
  for (const buffer of [
    valid.subarray(0, -1),
    Buffer.concat([valid, Buffer.from([8])]),
    Buffer.from([5, 120, 0, 8]),
    encode([
      { type: 1, key: 'x', value: 'a' },
      { type: 1, key: 'x', value: 'b' },
    ]),
  ])
    assert.throws(() => decode(buffer));
});

test('removed setups clean only tagged Steam entries, preserve fields, back up and retry safely', async () => {
  const h = fixture(),
    [account] = await h.service.list();
  await h.service.create(h.job, account.id);
  const owned = decode(fs.readFileSync(h.file))[0].value[0];
  fs.writeFileSync(h.file, shortcutFile([owned, { ...unrelated, key: '1' }]));
  const before = fs.readFileSync(h.file);
  await assert.rejects(h.service.remove(h.job), /Only removed/);
  h.job.status = 'removed';
  fs.unlinkSync(path.join(h.job.destination, 'profile', 'ModOrganizer.exe'));
  h.service.closed = async () => {
    throw new Error('Exit Steam');
  };
  await assert.rejects(h.service.remove(h.job), /Exit Steam/);
  assert.deepEqual(fs.readFileSync(h.file), before);
  h.service.closed = async () => {};
  const backups = await h.service.remove(h.job);
  assert.deepEqual(fs.readFileSync(backups[0]), before);
  const after = decode(fs.readFileSync(h.file))[0].value;
  assert.equal(after.length, 1);
  assert.equal(after[0].key, '0');
  assert.deepEqual(
    after[0].value,
    decode(shortcutFile([unrelated]))[0].value[0].value,
  );
  assert.deepEqual(await h.service.remove(h.job), []);
  fs.writeFileSync(h.file, 'broken');
  await assert.rejects(h.service.remove(h.job));
  assert.equal(fs.readFileSync(h.file, 'utf8'), 'broken');
});

test('desktop cleanup verifies ownership and works after the executable is removed', () => {
  const { removeDesktopShortcut } = require('../electron/shortcuts.cjs');
  const desktop = fs.mkdtempSync(
    path.join(os.tmpdir(), 'loadstone-desktop-cleanup-'),
  );
  const job = { id: crypto.randomUUID(), name: 'Test', status: 'removed' };
  const file = path.join(desktop, `Loadstone - Test - ${job.id}.lnk`);
  fs.writeFileSync(file, 'unrelated');
  assert.throws(
    () =>
      removeDesktopShortcut(job, desktop, {
        readShortcutLink: () => ({ description: 'Other app' }),
      }),
    /left unchanged/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), 'unrelated');
  const shell = {
    readShortcutLink: () => ({ description: `Loadstone setup ${job.id}` }),
  };
  removeDesktopShortcut(job, desktop, shell);
  assert.equal(fs.existsSync(file), false);
  removeDesktopShortcut(job, desktop, shell);
});

test('different setup versions get distinct Steam names while an existing entry keeps its app ID', async () => {
  const h = fixture(),
    [account] = await h.service.list();
  const first = await h.service.create(h.job, account.id);
  const next = {
    ...h.job,
    id: crypto.randomUUID(),
    manifest: { ...h.job.manifest, version: '2.0' },
  };
  fs.writeFileSync(
    path.join(h.job.destination, '.loadstone-owner.json'),
    JSON.stringify({ jobId: next.id, setupId: next.setupId }),
  );
  await h.service.create(next, account.id);
  const entries = decode(fs.readFileSync(h.file))[0].value;
  assert.deepEqual(
    entries.map((node) => field(node.value, 'AppName').value),
    ['Test game 1.0 — Loadstone', 'Test game 2.0 — Loadstone'],
  );
  assert.equal(field(entries[0].value, 'appid').value, first.appid);
});

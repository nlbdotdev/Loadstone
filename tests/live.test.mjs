import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';
import { writeList } from './list-fixture.mjs';
const require = createRequire(import.meta.url);
const { validateManifest } = require('../electron/manifest.cjs');
const { parseVdf, discoverGames } = require('../electron/game-discovery.cjs');
const { LiveCatalog } = require('../electron/live-catalog.cjs');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
export function fixtureManifest() {
  return {
    schemaVersion: 1,
    id: 'test-setup',
    name: 'Integration fixture',
    version: '1.0',
    description: 'A test fixture, not a playable list.',
    author: 'Loadstone tests',
    website: 'https://example.com/list',
    game: {
      id: 'fnv',
      versions: ['fixture'],
      executableHashes: [hash('game')],
      requiredFiles: [{ path: 'Data/Test.esm', sha256: hash('dlc') }],
    },
    storage: { downloadBytes: 1024, installBytes: 1024 },
    archive: {
      file: 'fixture.wabbajack',
      sha256: hash('archive'),
      source: 'https://example.com/archive',
    },
    launch: { manager: 'mo2', profile: 'Fixture', executable: 'NVSE' },
    credits: [
      {
        name: 'Test fixture',
        author: 'Loadstone tests',
        source: 'https://example.com',
        license: 'Created for automated tests only.',
      },
    ],
  };
}
test('manifests reject traversal, executable recipes, missing hashes, and incomplete credits', () => {
  assert.equal(validateManifest(fixtureManifest()).id, 'test-setup');
  for (const modify of [
    (m) => (m.archive.file = '../escape.wabbajack'),
    (m) => (m.archive.file = 'C:\\escape.wabbajack'),
    (m) => (m.launch.command = 'powershell'),
    (m) => (m.game.executableHashes = []),
    (m) => (m.credits = []),
    (m) => (m.website = 'https://user:secret@example.com'),
    (m) => (m.game.requiredFiles[0].path = 'Data/../../escape'),
  ]) {
    const manifest = fixtureManifest();
    modify(manifest);
    assert.throws(() => validateManifest(manifest), /Invalid setup manifest/);
  }
});
test('Steam discovery uses app metadata across libraries and confirms executables', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-steam-'));
  const library = path.join(root, 'Other Library');
  const folder = path.join(library, 'steamapps', 'common', 'Fallout New Vegas');
  fs.mkdirSync(folder, { recursive: true });
  fs.mkdirSync(path.join(root, 'steamapps'));
  fs.writeFileSync(
    path.join(root, 'steamapps', 'libraryfolders.vdf'),
    `"libraryfolders" { "0" { "path" "${library.replaceAll('\\', '\\\\')}" } }`,
  );
  fs.writeFileSync(
    path.join(library, 'steamapps', 'appmanifest_22380.acf'),
    '"AppState" { "appid" "22380" "installdir" "Fallout New Vegas" "buildid" "123" }',
  );
  assert.equal(discoverGames([root]).games.length, 0);
  fs.writeFileSync(path.join(folder, 'FalloutNV.exe'), 'game');
  assert.equal(discoverGames([root]).games[0].folder, fs.realpathSync(folder));
  assert.throws(() => parseVdf('"libraryfolders" { "0" "broken"'), /Truncated/);
  assert.throws(() => parseVdf('"x" "a" "x" "b"'), /Invalid/);
});
test('live preflight hashes real files and rejects unsafe destinations without changing game files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-live-'));
  const user = path.join(root, 'user'),
    source = path.join(root, 'source'),
    game = path.join(root, 'game');
  for (const dir of [user, source, path.join(game, 'Data')])
    fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(game, 'FalloutNV.exe'), 'game');
  fs.writeFileSync(path.join(game, 'Data', 'Test.esm'), 'dlc');
  await writeList(path.join(source, 'fixture.wabbajack'));
  const file = path.join(source, 'setup.json');
  const manifest = fixtureManifest();
  manifest.archive.sha256 = hash(
    fs.readFileSync(path.join(source, 'fixture.wabbajack')),
  );
  fs.writeFileSync(file, JSON.stringify(manifest));
  const catalog = new LiveCatalog(user);
  catalog.import(file);
  assert.equal(new LiveCatalog(user).list().length, 1);
  assert.throws(() => catalog.import(file), /already imported/);
  const destination = path.join(root, 'setup');
  const result = await catalog.preflight({
    id: 'test-setup',
    gameFolder: game,
    destination,
  });
  assert.deepEqual(
    result.checks.map((c) => c.status),
    ['pass', 'pass', 'pass', 'pass', 'fail'],
  );
  assert.equal(
    result.ready,
    false,
    'an unconnected installer must never report ready',
  );
  assert.equal(fs.existsSync(destination), false);
  const unsafe = await catalog.preflight({
    id: 'test-setup',
    gameFolder: game,
    destination: path.join(game, 'mods'),
  });
  assert.equal(unsafe.checks[3].status, 'fail');
  fs.writeFileSync(path.join(source, 'fixture.wabbajack'), 'tampered');
  fs.writeFileSync(path.join(game, 'FalloutNV.exe'), 'wrong-version');
  const mismatch = await catalog.preflight({
    id: 'test-setup',
    gameFolder: game,
    destination,
  });
  assert.equal(mismatch.checks[0].status, 'fail');
  assert.equal(mismatch.checks[2].status, 'fail');
  assert.equal(
    fs.readFileSync(path.join(game, 'Data', 'Test.esm'), 'utf8'),
    'dlc',
  );
  const alias = path.join(root, 'game-link');
  fs.symlinkSync(
    game,
    alias,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const junction = await catalog.preflight({
    id: 'test-setup',
    gameFolder: game,
    destination: path.join(alias, 'mods'),
  });
  assert.equal(
    junction.checks[3].status,
    'fail',
    'a junction must not bypass game-folder protection',
  );
});
test(
  'real Electron imports a live manifest, shows real preflight failures, and preserves it across restart',
  { timeout: 60000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-live-ui-'));
    const dataDir = path.join(root, 'user'),
      file = path.join(root, 'setup.json');
    fs.writeFileSync(file, JSON.stringify(fixtureManifest()));
    let app;
    async function start() {
      app = await electron.launch({
        executablePath: process.env.LOADSTONE_TEST_EXE || require('electron'),
        args: process.env.LOADSTONE_TEST_EXE
          ? []
          : [path.resolve(import.meta.dirname, '..')],
        env: { ...process.env, LOADSTONE_DATA_DIR: dataDir },
      });
      const page = await app.firstWindow();
      await page
        .getByRole('button', { name: 'Discover', exact: true })
        .waitFor();
      return page;
    }
    try {
      let page = await start();
      await page.evaluate(() =>
        window.loadstone.settings({ dummyData: false }),
      );
      await page
        .getByRole('heading', { name: 'No live setups imported' })
        .waitFor();
      await app.evaluate(({ dialog }, manifestFile) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [manifestFile],
        });
      }, file);
      await page
        .getByRole('button', { name: 'Import setup', exact: true })
        .click();
      await page
        .getByRole('heading', {
          name: 'Integration fixture',
          exact: true,
          level: 2,
        })
        .waitFor();
      await page
        .getByLabel('Game installation', { exact: true })
        .fill(path.join(root, 'missing-game'));
      await page
        .getByLabel('Setup installation', { exact: true })
        .fill(path.join(root, 'setup'));
      await page
        .getByRole('button', { name: 'Check compatibility', exact: true })
        .click();
      await page.getByText('Installation engine', { exact: true }).waitFor();
      fs.mkdirSync(path.resolve(import.meta.dirname, '..', 'test-results'), {
        recursive: true,
      });
      await page.screenshot({
        path: path.resolve(
          import.meta.dirname,
          '..',
          'test-results',
          'live-preflight.png',
        ),
      });
      assert.equal(
        await page
          .getByText('Install or repair the engine in Settings.', {
            exact: true,
          })
          .isVisible(),
        true,
      );
      assert.equal(fs.existsSync(path.join(root, 'setup')), false);
      await app.close();
      app = null;
      page = await start();
      await page
        .getByRole('heading', {
          name: 'Integration fixture',
          level: 3,
          exact: true,
        })
        .waitFor();
      const lists = await page.evaluate(() => window.loadstone.liveCatalog());
      assert.equal(lists.length, 1);
      assert.equal(
        (await page.evaluate(() => window.loadstone.getState())).installed
          .length,
        0,
      );
    } finally {
      if (app) await app.close();
    }
  },
);

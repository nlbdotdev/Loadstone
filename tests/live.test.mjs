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
      const destination = path.join(root, 'completed-fixture');
      const output = path.join(destination, 'profile');
      const jobId = crypto.randomUUID();
      fs.mkdirSync(path.join(output, 'profiles', 'Fixture'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(destination, '.loadstone-owner.json'),
        JSON.stringify({ jobId, setupId: 'test-setup' }),
      );
      fs.writeFileSync(path.join(output, 'ModOrganizer.exe'), 'MZfixture');
      fs.writeFileSync(path.join(output, 'game.exe'), 'MZfixture');
      fs.writeFileSync(
        path.join(output, 'ModOrganizer.ini'),
        '[customExecutables]\n1\\title=NVSE\n1\\binary=game.exe\n',
      );
      fs.writeFileSync(
        path.join(output, 'profiles', 'Fixture', 'modlist.txt'),
        '#fixture',
      );
      fs.writeFileSync(
        path.join(dataDir, 'live-jobs.json'),
        JSON.stringify({
          schemaVersion: 1,
          jobs: [
            {
              id: jobId,
              setupId: 'test-setup',
              name: 'Completed fixture',
              destination,
              gameFolder: path.join(root, 'missing-game'),
              manifest: fixtureManifest(),
              status: 'installed',
              logs: ['Controlled test output'],
              error: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      );
      page = await start();
      const testDesktop = path.join(root, 'desktop');
      fs.mkdirSync(testDesktop);
      await app.evaluate(
        ({ app }, folder) => app.setPath('desktop', folder),
        testDesktop,
      );
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
      await page
        .getByRole('button', { name: 'My library', exact: true })
        .click();
      await page.getByRole('heading', { name: 'Completed fixture' }).waitFor();
      assert.equal(
        await page
          .getByRole('button', { name: 'Remove setup', exact: true })
          .isEnabled(),
        true,
      );
      await page
        .getByRole('button', { name: 'Check profile', exact: true })
        .click();
      await page
        .getByRole('alert')
        .filter({ hasText: 'portable.txt' })
        .waitFor();
      fs.writeFileSync(path.join(output, 'portable.txt'), '');
      await page
        .getByRole('button', { name: 'Check profile', exact: true })
        .click();
      await page
        .getByRole('status')
        .filter({ hasText: 'passed structural checks' })
        .waitFor();
      assert.equal(
        await page
          .getByRole('button', { name: 'Launch setup', exact: true })
          .isEnabled(),
        true,
      );
      await page
        .getByRole('button', { name: 'Create desktop shortcut', exact: true })
        .waitFor();
      await app.evaluate(({ shell }) => {
        const read = shell.readShortcutLink;
        globalThis.shortcutReads = [];
        shell.readShortcutLink = (file) => {
          const result = read(file);
          globalThis.shortcutReads.push(result);
          return result;
        };
      });
      await page
        .getByRole('button', { name: 'Create desktop shortcut', exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.body.textContent.includes('Repair desktop shortcut') ||
          !!document.querySelector('[role="alert"]')?.textContent,
      );
      const shortcutErrors = await page.getByRole('alert').allTextContents();
      assert.deepEqual(
        shortcutErrors,
        [],
        'Native shortcut creation: ' +
          shortcutErrors.join('; ') +
          JSON.stringify(await app.evaluate(() => globalThis.shortcutReads)),
      );
      await page
        .getByRole('button', { name: 'Repair desktop shortcut', exact: true })
        .waitFor();
      const shortcut = path.join(
        testDesktop,
        fs.readdirSync(testDesktop).find((name) => name.endsWith('.lnk')),
      );
      const details = await app.evaluate(
        ({ shell }, file) => shell.readShortcutLink(file),
        shortcut,
      );
      assert.equal(
        fs.realpathSync.native(details.target).toLowerCase(),
        fs.realpathSync
          .native(path.join(output, 'ModOrganizer.exe'))
          .toLowerCase(),
      );
      assert.equal(details.args, '"-p" "Fixture" "run" "-e" "NVSE"');
      fs.unlinkSync(shortcut);
      await page
        .getByRole('button', { name: 'Repair desktop shortcut', exact: true })
        .click();
      await page.waitForFunction(
        () => !document.querySelector('.launch-actions button')?.disabled,
      );
      assert.equal(fs.existsSync(shortcut), true);
      await app.evaluate(
        ({ shell }, file) =>
          shell.writeShortcutLink(file, 'update', {
            args: 'outdated arguments',
          }),
        shortcut,
      );
      await page
        .getByRole('button', { name: 'Repair desktop shortcut', exact: true })
        .click();
      await page.waitForFunction(
        () => !document.querySelector('.launch-actions button')?.disabled,
      );
      assert.equal(
        await app.evaluate(
          ({ shell }, file) => shell.readShortcutLink(file).args,
          shortcut,
        ),
        details.args,
      );
      await app.evaluate(
        ({ shell }, file) =>
          shell.writeShortcutLink(file, 'update', {
            description: 'Unrelated shortcut',
          }),
        shortcut,
      );
      const unrelated = fs.readFileSync(shortcut);
      await page
        .getByRole('button', { name: 'Repair desktop shortcut', exact: true })
        .click();
      await page
        .getByRole('alert')
        .filter({ hasText: 'left unchanged' })
        .waitFor();
      assert.deepEqual(fs.readFileSync(shortcut), unrelated);
      await page.screenshot({
        path: path.resolve('test-results/live-library.png'),
      });
      await page
        .getByRole('button', { name: 'Add or repair Steam entry', exact: true })
        .click();
      await page
        .getByText(
          'Exit Steam completely before saving. Existing entries are backed up and preserved.',
          { exact: true },
        )
        .waitFor();
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 0,
          checkboxChecked: false,
        });
      });
      await page
        .getByRole('button', { name: 'Remove setup', exact: true })
        .click();
      await page.waitForFunction(
        () => !document.querySelector('.live-job button')?.disabled,
      );
      assert.ok(fs.existsSync(path.join(output, 'ModOrganizer.exe')));
      assert.equal(
        (await page.evaluate(() => window.loadstone.liveJobs()))[0].status,
        'installed',
      );
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async (_window, options) => {
          globalThis.removalDialog = options;
          return { response: 1, checkboxChecked: false };
        };
      });
      await page
        .getByRole('button', { name: 'Remove setup', exact: true })
        .click();
      await page
        .getByRole('heading', {
          name: 'No live setups installed yet',
          exact: true,
        })
        .waitFor();
      const removed = (
        await page.evaluate(() => window.loadstone.liveJobs())
      )[0];
      assert.equal(removed.status, 'removed');
      assert.equal(fs.existsSync(destination), false);
      assert.equal(
        fs.readFileSync(
          path.join(
            removed.removalRecoveryPath,
            'profile/profiles/Fixture/modlist.txt',
          ),
          'utf8',
        ),
        '#fixture',
      );
      assert.match(
        (await app.evaluate(() => globalThis.removalDialog)).detail,
        /Other files inside the profile folder, including custom mods/,
      );
      await page.evaluate(() => window.loadstone.settings({ dummyData: true }));
      await assert.rejects(
        page.evaluate((id) => window.loadstone.removeLive(id), jobId),
        /live workspace/,
      );
      await assert.rejects(
        page.evaluate((id) => window.loadstone.launchLive(id), jobId),
        /live workspace/,
      );
      await assert.rejects(
        page.evaluate(
          (id) => window.loadstone.steamShortcut(id, 'invalid'),
          jobId,
        ),
        /live workspace/,
      );
    } finally {
      if (app) await app.close();
    }
  },
);

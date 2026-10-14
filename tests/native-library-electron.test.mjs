import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';
import { libraryFixture } from './native-library-fixture.mjs';
const require = createRequire(import.meta.url);
const { decode, field } = require('../electron/steam-vdf.cjs');

test(
  'real Electron registers, verifies and removes a native candidate with isolated shortcuts and retained saves',
  { timeout: 60000 },
  async () => {
    const f = await libraryFixture();
    const desktop = path.join(f.root, 'fixture-desktop'),
      steam = path.join(f.root, 'fixture-steam');
    const config = path.join(steam, 'userdata', '1234', 'config');
    fs.mkdirSync(desktop);
    fs.mkdirSync(config, { recursive: true });
    const env = { ...process.env, LOADSTONE_DATA_DIR: f.state };
    delete env.ELECTRON_RUN_AS_NODE;
    const start = () =>
      electron.launch({
        executablePath: process.env.LOADSTONE_TEST_EXE || require('electron'),
        args: process.env.LOADSTONE_TEST_EXE ? [] : [path.resolve('.')],
        env,
      });
    let instance = await start();
    try {
      let page = await instance.firstWindow();
      await page
        .getByRole('button', { name: 'Explore the demo', exact: true })
        .click();
      await assert.rejects(
        page.evaluate(() => window.loadstone.prepareNativeLibrary()),
        /live workspace/,
      );
      await page.evaluate(() =>
        window.loadstone.settings({ dummyData: false }),
      );
      await instance.evaluate(
        ({ app, dialog }, fixture) => {
          app.setPath('desktop', fixture.desktop);
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [fixture.destination],
          });
          const { SteamShortcuts } = process.mainModule.require(
            app.getAppPath() + '/electron/steam-shortcuts.cjs',
          );
          const accounts = SteamShortcuts.prototype.accounts;
          SteamShortcuts.prototype.accounts = async function () {
            this.roots = async () => [fixture.steam];
            this.closed = async () => {};
            return accounts.call(this);
          };
        },
        { desktop, steam, destination: f.destination },
      );
      await page
        .getByRole('button', { name: 'My library', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Add native candidate', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Add to library', exact: true })
        .waitFor();
      assert.equal(
        (await page.evaluate(() => window.loadstone.nativeLibrary())).entries
          .length,
        0,
      );
      await page
        .getByRole('button', { name: 'Add to library', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Launch native setup', exact: true })
        .waitFor();
      const entry = (
        await page.evaluate(() => window.loadstone.nativeLibrary())
      ).entries[0];
      await page
        .getByRole('button', {
          name: 'Add or repair desktop shortcut',
          exact: true,
        })
        .click();
      await page
        .getByRole('status')
        .filter({ hasText: 'Desktop shortcut created' })
        .waitFor();
      const shortcut = path.join(
        desktop,
        fs.readdirSync(desktop).find((v) => v.endsWith('.lnk')),
      );
      const details = await instance.evaluate(
        ({ shell }, file) => shell.readShortcutLink(file),
        shortcut,
      );
      assert.equal(
        fs.realpathSync.native(details.target).toLowerCase(),
        fs.realpathSync
          .native(path.join(f.destination, 'ModOrganizer.exe'))
          .toLowerCase(),
      );
      assert.equal(details.args, '"-p" "Test" "run" "-e" "New Vegas"');
      await page
        .getByRole('button', { name: 'Add or repair Steam entry', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Save Steam entry', exact: true })
        .click();
      await page
        .getByRole('status')
        .filter({ hasText: 'Steam entry' })
        .waitFor();
      const entries = decode(
        fs.readFileSync(path.join(config, 'shortcuts.vdf')),
      )[0].value;
      assert.equal(entries.length, 1);
      assert.equal(
        field(entries[0].value, 'LaunchOptions').value,
        details.args,
      );
      assert.equal(
        field(entries[0].value, 'StartDir').value,
        '"' + f.destination + '"',
      );
      await page
        .getByRole('button', { name: 'Verify recipe files', exact: true })
        .click();
      await page
        .getByRole('status')
        .filter({ hasText: 'profile isolation verified' })
        .waitFor();
      const verifiedAt = (
        await page.evaluate(() => window.loadstone.nativeLibrary())
      ).entries[0].verifiedAt;
      const modlistFile = path.join(f.destination, 'profiles/Test/modlist.txt');
      const modlist = fs.readFileSync(modlistFile);
      fs.appendFileSync(modlistFile, '\nfixture mutation');
      await page
        .getByRole('button', { name: 'Verify recipe files', exact: true })
        .click();
      await page
        .getByRole('alert')
        .filter({
          hasText:
            'Recipe file is missing, larger than expected, redirected or not an ordinary file: profiles/Test/modlist.txt',
        })
        .waitFor();
      assert.equal(
        (await page.evaluate(() => window.loadstone.nativeLibrary())).entries[0]
          .verifiedAt,
        verifiedAt,
      );
      assert.match(fs.readFileSync(modlistFile, 'utf8'), /fixture mutation$/);
      fs.writeFileSync(modlistFile, modlist);
      fs.mkdirSync('test-results', { recursive: true });
      await page.screenshot({ path: 'test-results/native-library.png' });
      // Reject before spawn: no synthetic or real game executable is ever run.
      fs.writeFileSync(
        path.join(f.destination, 'profiles/Test/settings.ini'),
        '[General]\nLocalSaves=false\nLocalSettings=true\n',
      );
      await assert.rejects(
        page.evaluate((id) => window.loadstone.launchNative(id), entry.id),
        /LocalSaves/,
      );
      await instance.close();
      instance = await start();
      page = await instance.firstWindow();
      await instance.evaluate(
        ({ app, dialog }, fixture) => {
          app.setPath('desktop', fixture.desktop);
          globalThis.removalChoice = 0;
          globalThis.nativeSteamBlocked = false;
          dialog.showMessageBox = async (_window, options) => {
            globalThis.nativeRemovalDialog = options;
            return { response: globalThis.removalChoice };
          };
          const { NativeMaintenance } = process.mainModule.require(
            app.getAppPath() + '/electron/native-maintenance.cjs',
          );
          NativeMaintenance.prototype.ensureIdle = async () => {};
          const { SteamShortcuts } = process.mainModule.require(
            app.getAppPath() + '/electron/steam-shortcuts.cjs',
          );
          const accounts = SteamShortcuts.prototype.accounts;
          SteamShortcuts.prototype.accounts = async function () {
            this.roots = async () => [fixture.steam];
            this.closed = async () => {
              if (globalThis.nativeSteamBlocked)
                throw new Error('fixture Steam running');
            };
            return accounts.call(this);
          };
        },
        { desktop, steam },
      );
      assert.equal(
        (await page.evaluate(() => window.loadstone.nativeLibrary())).entries[0]
          .id,
        entry.id,
      );
      await assert.rejects(
        page.evaluate(
          (id) => window.loadstone.nativeDesktopShortcut(id),
          entry.id,
        ),
        /LocalSaves/,
      );
      assert.equal(
        fs.readFileSync(path.join(f.owned, 'FalloutNV.exe'), 'utf8'),
        'MZ synthetic owned game; never execute',
      );
      fs.mkdirSync(path.join(f.destination, 'profiles/Test/saves'));
      fs.writeFileSync(
        path.join(f.destination, 'profiles/Test/saves/test.fos'),
        'synthetic saved progress',
      );
      fs.writeFileSync(
        path.join(f.destination, 'Game/user.data'),
        'preserve user data',
      );
      await page.evaluate((id) => window.loadstone.removeNative(id), entry.id);
      assert.equal(fs.existsSync(f.destination), true);
      assert.equal(
        (await page.evaluate(() => window.loadstone.nativeLibrary())).entries[0]
          .status,
        'installed',
      );
      const review = await instance.evaluate(
        () => globalThis.nativeRemovalDialog,
      );
      assert.match(review.message, /3 unchanged recipe files/);
      assert.match(review.detail, /modified files and untracked content/);
      assert.equal(review.defaultId, 0);
      await instance.evaluate(() => {
        globalThis.removalChoice = 1;
        globalThis.nativeSteamBlocked = true;
      });
      await page
        .getByRole('button', { name: 'My library', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Remove native setup', exact: true })
        .click();
      await page.getByText('fixture Steam running', { exact: true }).waitFor();
      const removed = (
        await page.evaluate(() => window.loadstone.nativeLibrary())
      ).entries[0];
      assert.equal(removed.status, 'removed');
      assert.equal(removed.shortcutsCleaned, false);
      assert.equal(fs.existsSync(f.destination), false);
      assert.equal(fs.existsSync(shortcut), false);
      assert.equal(
        fs.readFileSync(
          path.join(removed.recoveryRoot, 'profiles/Test/saves/test.fos'),
          'utf8',
        ),
        'synthetic saved progress',
      );
      assert.equal(
        fs.readFileSync(
          path.join(removed.recoveryRoot, 'Game/user.data'),
          'utf8',
        ),
        'preserve user data',
      );
      await instance.evaluate(() => {
        globalThis.nativeSteamBlocked = false;
      });
      await page
        .getByRole('button', { name: 'Clean up native shortcuts', exact: true })
        .click();
      await page
        .getByText('Owned shortcuts cleaned up.', { exact: true })
        .waitFor();
      assert.equal(
        decode(fs.readFileSync(path.join(config, 'shortcuts.vdf')))[0].value
          .length,
        0,
      );
      await page.screenshot({ path: 'test-results/native-removal.png' });
      await instance.close();
      instance = await start();
      page = await instance.firstWindow();
      const persisted = (
        await page.evaluate(() => window.loadstone.nativeLibrary())
      ).entries[0];
      assert.equal(persisted.status, 'removed');
      assert.equal(persisted.shortcutsCleaned, true);
    } finally {
      await instance.close();
    }
  },
);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';
import { libraryFixture } from './native-library-fixture.mjs';
const require = createRequire(import.meta.url);

test(
  'actual Electron installs a native package without JSON, tracks it in Downloads and admits its exact folder to the library',
  { timeout: 60000 },
  async () => {
    const f = await libraryFixture(),
      parent = path.join(f.root, 'guided');
    fs.mkdirSync(parent);
    const env = { ...process.env, LOADSTONE_DATA_DIR: f.state };
    delete env.ELECTRON_RUN_AS_NODE;
    const options = {
      executablePath: process.env.LOADSTONE_TEST_EXE || require('electron'),
      args: process.env.LOADSTONE_TEST_EXE ? [] : [path.resolve('.')],
      env,
    };
    let instance = await electron.launch(options);
    try {
      let page = await instance.firstWindow();
      await page
        .getByRole('button', { name: 'Explore the demo', exact: true })
        .click();
      await assert.rejects(
        page.evaluate(() => window.loadstone.importNativeSetup()),
        /live workspace/,
      );
      await page.evaluate(() =>
        window.loadstone.settings({ dummyData: false }),
      );
      await instance.evaluate(
        ({ app, dialog }, fixture) => {
          const files = [fixture.packageFile, fixture.parent];
          globalThis.guideDialogs = [];
          dialog.showOpenDialog = async (_window, options) => {
            globalThis.guideDialogs.push(options.title);
            return { canceled: false, filePaths: [files.shift()] };
          };
          const { NativeGuide } = process.mainModule.require(
            app.getAppPath() + '/electron/native-guide.cjs',
          );
          NativeGuide.prototype.discover = async () => ({
            games: [{ id: 'fnv', source: 'steam', folder: fixture.game }],
          });
          const { NativeBuilder } = process.mainModule.require(
            app.getAppPath() + '/electron/native-builder.cjs',
          );
          NativeBuilder.prototype.ensureIdle = async () => {};
          const change = NativeBuilder.prototype.change;
          globalThis.stopFirstGuidedBuild = true;
          NativeBuilder.prototype.change = function (id, patch, persist) {
            change.call(this, id, patch, persist);
            if (
              globalThis.stopFirstGuidedBuild &&
              patch.completed === 1 &&
              !patch.status
            ) {
              globalThis.stopFirstGuidedBuild = false;
              this.cancel(id);
            }
          };
          globalThis.admitChoice = 0;
          dialog.showMessageBox = async (_window, options) => {
            globalThis.admitDialog = options;
            return { response: globalThis.admitChoice };
          };
        },
        { packageFile: f.packageFile, parent, game: f.owned },
      );
      await page
        .getByRole('button', { name: 'Open .loadstone', exact: true })
        .click();
      const setup = page.getByRole('region', {
        name: 'Install a native setup',
      });
      await setup
        .getByText('Native fixture', { exact: false })
        .first()
        .waitFor();
      await setup
        .getByRole('button', {
          name: 'Choose installation location',
          exact: true,
        })
        .click();
      await setup
        .getByRole('button', { name: 'Review installation', exact: true })
        .click();
      const review = page.getByRole('region', {
        name: 'Review native installation',
      });
      await review.waitFor();
      assert.match(
        (await review.textContent()).replace(/\s+/g, ' '),
        /starts no game and imports no saves/,
      );
      const dialogs = await instance.evaluate(() => globalThis.guideDialogs);
      assert.equal(dialogs.length, 2);
      assert.equal(
        dialogs.some((v) => /JSON/i.test(v)),
        false,
      );
      fs.mkdirSync('test-results', { recursive: true });
      await setup.screenshot({
        path: 'test-results/native-guided-install.png',
      });
      await review
        .getByRole('button', { name: 'Install native setup', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'Native installations', exact: true })
        .waitFor();
      await page.getByText('Build cancelled', { exact: true }).waitFor();
      const interrupted = (
        await page.evaluate(() => window.loadstone.nativeBuilds())
      )[0];
      await instance.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [file],
        });
      }, f.packageFile);
      await page
        .getByRole('button', { name: 'Review resume', exact: true })
        .click();
      await setup
        .getByRole('button', { name: 'Review installation', exact: true })
        .click();
      await review
        .getByRole('button', { name: 'Resume installation', exact: true })
        .click();
      await page
        .getByText('Files verified · Launch untested', { exact: true })
        .waitFor();
      const jobs = await page.evaluate(() => window.loadstone.nativeBuilds());
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].status, 'verified');
      assert.equal(jobs[0].id, interrupted.id);
      assert.equal(jobs[0].destination, interrupted.destination);
      assert.equal(path.dirname(jobs[0].destination), parent);
      await page
        .getByRole('button', { name: 'Review for My library', exact: true })
        .click();
      // The default cancellation does not create a library record.
      await page
        .getByRole('button', { name: 'Review for My library', exact: true })
        .waitFor({ state: 'visible' });
      await page.waitForFunction(() =>
        window.loadstone.nativeLibrary().then((v) => !v.busy),
      );
      assert.equal(
        (await page.evaluate(() => window.loadstone.nativeLibrary())).entries
          .length,
        0,
      );
      const dialog = await instance.evaluate(() => globalThis.admitDialog);
      assert.equal(dialog.defaultId, 0);
      assert.match(dialog.detail, /No actual|Synthetic|synthetic/);
      await instance.evaluate(() => (globalThis.admitChoice = 1));
      await page
        .getByRole('button', { name: 'Review for My library', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'Your native setups.', exact: true })
        .waitFor();
      const library = await page.evaluate(() =>
        window.loadstone.nativeLibrary(),
      );
      assert.equal(library.entries.length, 1);
      assert.equal(library.entries[0].root, jobs[0].destination);
      assert.equal(
        fs.readFileSync(path.join(f.owned, 'FalloutNV.exe'), 'utf8'),
        'MZ synthetic owned game; never execute',
      );
      assert.equal(
        fs.existsSync(path.join(jobs[0].destination, 'profiles/Test/saves')),
        false,
      );
      await instance.close();
      instance = await electron.launch(options);
      page = await instance.firstWindow();
      assert.equal(
        await page.evaluate(() => window.loadstone.nativeGuide()),
        null,
      );
      assert.equal(
        (await page.evaluate(() => window.loadstone.nativeLibrary())).entries[0]
          .root,
        jobs[0].destination,
      );
      assert.equal(
        (await page.evaluate(() => window.loadstone.nativeBuilds()))[0].status,
        'verified',
      );
    } finally {
      await instance.close();
    }
  },
);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';
import { libraryFixture } from './native-library-fixture.mjs';
import { packNativeRecipe } from '../scripts/native-package.mjs';
const require = createRequire(import.meta.url);
const { NativeLibrary } = require('../electron/native-library.cjs');

test(
  'actual Electron installs another native version in a separate folder and retains both library entries across restart',
  { timeout: 60000 },
  async () => {
    const f = await libraryFixture({
      extraFiles: [['mods/Test/settings.ini', 'recipe settings']],
    });
    const library = new NativeLibrary(f.state);
    library.register((await library.prepare(async () => f.destination)).id);
    const original = structuredClone(library.entries[0]);
    const personal = path.join(f.destination, 'mods/Test/settings.ini');
    fs.writeFileSync(personal, 'personal settings');
    fs.mkdirSync(path.join(f.destination, 'profiles/Test/saves'));
    const save = path.join(f.destination, 'profiles/Test/saves/canary.fos');
    fs.writeFileSync(save, 'original playthrough');
    f.recipe.version = '2.0.0';
    f.recipe.saveCompatibility = {
      status: 'new-save-required',
      notes: 'Start a fresh playthrough for version 2.',
    };
    const nextFile = path.join(f.root, 'packages', 'next.loadstone');
    await packNativeRecipe(f.recipe, f.payloads, nextFile);
    const env = { ...process.env, LOADSTONE_DATA_DIR: f.state };
    delete env.ELECTRON_RUN_AS_NODE;
    const launch = () =>
      electron.launch({
        executablePath: process.env.LOADSTONE_TEST_EXE || require('electron'),
        args: process.env.LOADSTONE_TEST_EXE ? [] : [path.resolve('.')],
        env,
      });
    let instance = await launch();
    try {
      let page = await instance.firstWindow();
      await page
        .getByRole('button', { name: 'Explore the demo', exact: true })
        .click();
      await assert.rejects(
        page.evaluate(
          (id) => window.loadstone.updateNativeSetup(id),
          original.id,
        ),
        /live workspace/,
      );
      await page.evaluate(() =>
        window.loadstone.settings({ dummyData: false }),
      );
      await instance.evaluate(
        ({ app, dialog }, fixture) => {
          globalThis.updatePackage = fixture.originalPackage;
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [globalThis.updatePackage],
          });
          dialog.showMessageBox = async (_window, options) => {
            globalThis.updateAdmission = options;
            return { response: 1 };
          };
          const { NativeGuide } = process.mainModule.require(
            app.getAppPath() + '/electron/native-guide.cjs',
          );
          NativeGuide.prototype.discover = async () => ({
            games: [{ id: 'fnv', source: 'steam', folder: fixture.owned }],
          });
        },
        { originalPackage: f.packageFile, owned: f.owned },
      );
      await page
        .getByRole('button', { name: 'My library', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Install another version', exact: true })
        .click();
      await page
        .getByRole('alert')
        .filter({ hasText: 'This is the installed version' })
        .waitFor();
      assert.equal(
        await page.evaluate(() => window.loadstone.nativeGuide()),
        null,
      );
      await instance.evaluate((_electron, file) => {
        globalThis.updatePackage = file;
      }, nextFile);
      await page
        .getByRole('button', { name: 'Install another version', exact: true })
        .click();
      await page
        .getByRole('heading', {
          name: 'Try another version. Keep your playthrough.',
          exact: true,
        })
        .waitFor();
      const setup = page.getByRole('region', {
        name: 'Install a native setup',
      });
      const content = (await setup.textContent()).replace(/\s+/g, ' ');
      assert.match(content, /Start a new game/);
      assert.match(content, /Personal mods, settings and saves are not copied/);
      assert.match(
        content,
        /current setup, personal settings, saves and shortcuts stay available/,
      );
      await setup
        .getByRole('button', { name: 'Review installation', exact: true })
        .click();
      const review = page.getByRole('region', {
        name: 'Review native installation',
      });
      await review.waitFor();
      assert.match(
        (await review.textContent()).replace(/\s+/g, ' '),
        /Existing shortcuts continue to open the original version/,
      );
      const draft = await page.evaluate(() => window.loadstone.nativeGuide());
      assert.notEqual(draft.plan.destination, f.destination);
      await review.screenshot({
        path: 'test-results/native-update-review.png',
      });
      await review
        .getByRole('button', { name: 'Install separate version', exact: true })
        .click();
      await page
        .getByText('Files verified · Launch untested', { exact: true })
        .waitFor();
      assert.equal(
        (await page.evaluate(() => window.loadstone.nativeLibrary())).entries
          .length,
        1,
      );
      await page
        .getByRole('button', { name: 'Review for My library', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'Your native setups.', exact: true })
        .waitFor();
      await page.waitForFunction(
        async () =>
          (await window.loadstone.nativeLibrary()).entries.length === 2,
      );
      const entries = (
        await page.evaluate(() => window.loadstone.nativeLibrary())
      ).entries;
      assert.deepEqual(entries[0], { ...original, launch: entries[0].launch });
      assert.equal(entries[1].root, draft.plan.destination);
      assert.equal(entries[1].version, '2.0.0');
      assert.equal(entries[1].saveStatus, 'new-save-required');
      assert.equal(fs.readFileSync(personal, 'utf8'), 'personal settings');
      assert.equal(fs.readFileSync(save, 'utf8'), 'original playthrough');
      assert.equal(
        fs.readFileSync(
          path.join(entries[1].root, 'mods/Test/settings.ini'),
          'utf8',
        ),
        'recipe settings',
      );
      assert.equal(
        fs.existsSync(
          path.join(entries[1].root, 'profiles/Test/saves/canary.fos'),
        ),
        false,
      );
      const admission = await instance.evaluate(
        () => globalThis.updateAdmission,
      );
      assert.equal(admission.defaultId, 0);
      assert.match(admission.detail, /new-save-required/);
      await instance.close();
      instance = await launch();
      page = await instance.firstWindow();
      const restarted = (
        await page.evaluate(() => window.loadstone.nativeLibrary())
      ).entries;
      assert.equal(restarted.length, 2);
      assert.equal(restarted[0].id, original.id);
      assert.equal(restarted[1].id, entries[1].id);
      assert.equal(
        await page.evaluate(() => window.loadstone.nativeGuide()),
        null,
      );
    } finally {
      await instance.close();
    }
  },
);

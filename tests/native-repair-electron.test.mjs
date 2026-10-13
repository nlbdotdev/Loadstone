import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';
import { libraryFixture } from './native-library-fixture.mjs';
const require = createRequire(import.meta.url);
const { NativeLibrary } = require('../electron/native-library.cjs');

test(
  'actual Electron guides installed repair, preserves personal configuration and retains replacements across restart',
  { timeout: 60000 },
  async () => {
    const f = await libraryFixture({
      extraFiles: [
        ['mods/Test/asset.bin', 'original'],
        ['mods/Test/settings.ini', '[Options]\nvalue=original\n'],
      ],
    });
    const library = new NativeLibrary(f.state),
      id = (await library.prepare(async () => f.destination)).id;
    library.register(id);
    fs.writeFileSync(
      path.join(f.destination, 'mods/Test/asset.bin'),
      'changed asset',
    );
    fs.writeFileSync(
      path.join(f.destination, 'mods/Test/settings.ini'),
      '[Options]\nvalue=personal\n',
    );
    fs.mkdirSync(path.join(f.destination, 'profiles/Test/saves'));
    fs.writeFileSync(
      path.join(f.destination, 'profiles/Test/saves/canary.fos'),
      'untouched save',
    );
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
        page.evaluate((id) => window.loadstone.repairNativeSetup(id), id),
        /live workspace/,
      );
      await page.evaluate(() =>
        window.loadstone.settings({ dummyData: false }),
      );
      await instance.evaluate(
        ({ app, dialog }, fixture) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [fixture.packageFile],
          });
          const { NativeRepair } = process.mainModule.require(
            app.getAppPath() + '/electron/native-repair.cjs',
          );
          NativeRepair.prototype.ensureIdle = async () => {};
          const { NativeGuide } = process.mainModule.require(
            app.getAppPath() + '/electron/native-guide.cjs',
          );
          NativeGuide.prototype.discover = async () => ({
            games: [{ id: 'fnv', source: 'steam', folder: fixture.owned }],
          });
        },
        { packageFile: f.packageFile, owned: f.owned },
      );
      await page
        .getByRole('button', { name: 'My library', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Repair native setup', exact: true })
        .click();
      await page
        .getByRole('heading', {
          name: 'Repair your installed setup.',
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page
          .getByRole('button', {
            name: 'Choose installation location',
            exact: true,
          })
          .count(),
        0,
      );
      const restore = page.getByRole('checkbox', {
        name: 'Restore changed profiles and configuration to this recipe too',
        exact: true,
      });
      assert.equal(await restore.isChecked(), false);
      await page
        .getByRole('button', { name: 'Review repair', exact: true })
        .click();
      const review = page.getByRole('region', {
        name: 'Review native installation',
      });
      await review.waitFor();
      assert.match(
        (await review.textContent()).replace(/\s+/g, ' '),
        /1 changed files to retain and replace · 1 changed personal files to keep/,
      );
      await review.screenshot({
        path: 'test-results/native-repair-review.png',
      });
      await restore.check();
      await review.waitFor({ state: 'hidden' });
      await restore.uncheck();
      await page
        .getByRole('button', { name: 'Review repair', exact: true })
        .click();
      await review.waitFor();
      await review
        .getByRole('button', { name: 'Repair installed setup', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'Your native setups.', exact: true })
        .waitFor();
      await page
        .getByText(
          'Repair completed. Recipe replacements and retained personal files were verified.',
          { exact: true },
        )
        .waitFor();
      const entry = (
        await page.evaluate(() => window.loadstone.nativeLibrary())
      ).entries[0];
      assert.equal(entry.id, id);
      assert.equal(entry.root, f.destination);
      assert.equal(entry.repair.preserved, 1);
      assert.equal(
        fs.readFileSync(
          path.join(
            f.destination,
            entry.repair.directory,
            'mods/Test/asset.bin',
          ),
          'utf8',
        ),
        'changed asset',
      );
      assert.equal(
        fs.readFileSync(
          path.join(f.destination, 'mods/Test/asset.bin'),
          'utf8',
        ),
        'original',
      );
      assert.match(
        fs.readFileSync(
          path.join(f.destination, 'mods/Test/settings.ini'),
          'utf8',
        ),
        /personal/,
      );
      assert.equal(
        fs.readFileSync(
          path.join(f.destination, 'profiles/Test/saves/canary.fos'),
          'utf8',
        ),
        'untouched save',
      );
      await instance.close();
      instance = await launch();
      page = await instance.firstWindow();
      const restarted = (
        await page.evaluate(() => window.loadstone.nativeLibrary())
      ).entries[0];
      assert.equal(restarted.id, id);
      assert.equal(restarted.status, 'installed');
      assert.equal(restarted.repair.directory, entry.repair.directory);
      assert.equal(
        await page.evaluate(() => window.loadstone.nativeGuide()),
        null,
      );
    } finally {
      await instance.close();
    }
  },
);

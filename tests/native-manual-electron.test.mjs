import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';
import { manualFixture } from './native-manual-fixture.mjs';
const require = createRequire(import.meta.url);

test(
  'actual Electron guides manual Nexus downloads, rejects wrong bytes, cancels hashing and installs with no account or browser automation',
  { timeout: 60000 },
  async () => {
    const f = await manualFixture();
    const wrong = path.join(f.packages, 'wrong.zip');
    fs.writeFileSync(wrong, Buffer.alloc(f.source.bytes, 9));
    const env = { ...process.env, LOADSTONE_DATA_DIR: f.state };
    delete env.ELECTRON_RUN_AS_NODE;
    const instance = await electron.launch({
      executablePath: process.env.LOADSTONE_TEST_EXE || require('electron'),
      args: process.env.LOADSTONE_TEST_EXE ? [] : [path.resolve('.')],
      env,
    });
    try {
      const page = await instance.firstWindow();
      await page
        .getByRole('button', { name: 'Explore the demo', exact: true })
        .click();
      await assert.rejects(
        page.evaluate(() =>
          window.loadstone.openNativeSource('invalid', 'invalid'),
        ),
        /live workspace/,
      );
      await page.evaluate(
        (parent) =>
          window.loadstone.settings({ dummyData: false, installRoot: parent }),
        f.parent,
      );
      await instance.evaluate(
        ({ app, dialog, shell }, fixture) => {
          globalThis.manualSourceOpened = [];
          globalThis.manualSelectedArchive = fixture.wrong;
          globalThis.slowManualRead = false;
          shell.openExternal = async (url) => {
            globalThis.manualSourceOpened.push(url);
          };
          dialog.showOpenDialog = async (_window, options) => ({
            canceled: false,
            filePaths: [
              options.title === 'Choose a .loadstone setup'
                ? fixture.packageFile
                : options.title === 'Choose the original archive'
                  ? globalThis.manualSelectedArchive
                  : fixture.parent,
            ],
          });
          const { NativeGuide } = process.mainModule.require(
            app.getAppPath() + '/electron/native-guide.cjs',
          );
          NativeGuide.prototype.discover = async () => ({
            games: [{ id: 'fnv', source: 'steam', folder: fixture.game }],
          });
          const fs = process.mainModule.require('node:fs');
          const { Readable } = process.mainModule.require('node:stream');
          const originalRead = fs.createReadStream;
          fs.createReadStream = (...args) => {
            const stream = originalRead(...args);
            if (!globalThis.slowManualRead || args[0] !== fixture.archive)
              return stream;
            return Readable.from(
              (async function* () {
                for await (const chunk of stream) {
                  await new Promise((resolve) => setTimeout(resolve, 50));
                  yield chunk;
                }
              })(),
            );
          };
        },
        {
          packageFile: f.packageFile,
          game: f.game,
          parent: f.parent,
          archive: f.archive,
          wrong,
        },
      );
      await page
        .getByRole('button', { name: 'Open .loadstone', exact: true })
        .click();
      const setup = page.getByRole('region', {
        name: 'Install a native setup',
      });
      const manual = setup.getByRole('checkbox', {
        name: 'Download Nexus files in my browser',
        exact: true,
      });
      await manual.waitFor();
      assert.equal(await manual.isChecked(), true);
      const reviewButton = setup.getByRole('button', {
        name: 'Review installation',
        exact: true,
      });
      assert.equal(await reviewButton.isDisabled(), true);
      await setup
        .getByRole('button', { name: 'Open Nexus file page', exact: true })
        .click();
      assert.deepEqual(
        await instance.evaluate(() => globalThis.manualSourceOpened),
        ['https://www.nexusmods.com/falloutnv/mods/123?tab=files&file_id=456'],
      );
      await setup
        .getByRole('button', { name: 'Choose and verify archive', exact: true })
        .click();
      await setup.getByRole('alert').filter({ hasText: 'SHA-256' }).waitFor();
      assert.equal(await reviewButton.isDisabled(), true);
      assert.equal(
        (await page.evaluate(() => window.loadstone.nativeGuide())).archives[0]
          .file,
        null,
      );
      await instance.evaluate((_electron, file) => {
        globalThis.manualSelectedArchive = file;
        globalThis.slowManualRead = true;
      }, f.archive);
      await setup
        .getByRole('button', { name: 'Choose and verify archive', exact: true })
        .click();
      await setup
        .getByRole('button', {
          name: 'Cancel archive verification',
          exact: true,
        })
        .click();
      await setup
        .getByRole('alert')
        .filter({ hasText: 'Archive verification cancelled' })
        .waitFor();
      assert.equal(
        (await page.evaluate(() => window.loadstone.nativeGuide())).archives[0]
          .file,
        null,
      );
      await instance.evaluate(() => {
        globalThis.slowManualRead = false;
      });
      await setup
        .getByRole('button', { name: 'Choose and verify archive', exact: true })
        .click();
      await setup
        .getByText('1 / 1 Nexus archives verified. 0 remaining.', {
          exact: true,
        })
        .waitFor();
      assert.equal(await reviewButton.isEnabled(), true);
      const draft = await page.evaluate(() => window.loadstone.nativeGuide());
      assert.equal(draft.archives[0].verified, true);
      assert.equal(draft.selectionActivity, null);
      await setup.screenshot({
        path: 'test-results/manual-nexus-downloads.png',
      });
      await reviewButton.click();
      const review = page.getByRole('region', {
        name: 'Review native installation',
      });
      await review.waitFor();
      assert.equal(
        (await page.evaluate(() => window.loadstone.nativeGuide())).plan
          .downloadCount,
        0,
      );
      await review
        .getByRole('button', { name: 'Install native setup', exact: true })
        .click();
      await page
        .getByText('Files verified · Launch untested', { exact: true })
        .waitFor();
      const jobs = await page.evaluate(() => window.loadstone.nativeBuilds());
      assert.equal(jobs[0].status, 'verified');
      assert.equal(
        fs.statSync(path.join(jobs[0].destination, 'mods/Example/example.esp'))
          .size,
        2_000_000,
      );
      assert.equal(fs.statSync(f.archive).size, f.source.bytes);
      assert.equal(fs.statSync(wrong).size, f.source.bytes);
      assert.equal(fs.existsSync(path.join(f.state, 'nexus.bin')), false);
      assert.deepEqual(fs.readdirSync(f.cache), []);
    } finally {
      await instance.close();
    }
  },
);

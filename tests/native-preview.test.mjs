import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';
import { packNativeRecipe } from '../scripts/native-package.mjs';
import { createNativeFixture } from './native-fixture.mjs';
const require = createRequire(import.meta.url);
const { createNativePreview } = require('../electron/native-preview.cjs');

test('native preview serializes inspection, clears its guard on cancellation and exposes only a summary', async () => {
  const f = createNativeFixture(),
    file = path.join(f.root, 'fixture.loadstone');
  await packNativeRecipe(f.recipe, f.payloads, file);
  const inspect = createNativePreview();
  let release;
  const pending = inspect(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await assert.rejects(
    inspect(async () => file),
    /Wait for the current/,
  );
  release(null);
  assert.equal(await pending, null);
  const summary = await inspect(async () => file);
  assert.equal(summary.outputs, 5);
  assert.equal(summary.payloadSources, 4);
  assert.equal(summary.gameSources, 1);
  assert.equal(summary.downloadSources, 0);
  assert.equal('recipe' in summary, false);
  assert.equal('sources' in summary, false);
  assert.equal(JSON.stringify(summary).includes(f.root), false);
  await assert.rejects(
    inspect(async () => path.join(f.root, 'bad.txt')),
    /Choose a .loadstone/,
  );
  assert.equal((await inspect(async () => file)).name, f.recipe.name);
});

test(
  'real Electron previews a native package without importing or installing it and handles invalid selection',
  { timeout: 60000 },
  async () => {
    const f = createNativeFixture(),
      file = path.join(f.root, 'fixture.loadstone');
    await packNativeRecipe(f.recipe, f.payloads, file);
    const before = fs.readFileSync(file);
    const env = {
      ...process.env,
      LOADSTONE_DATA_DIR: path.join(f.root, 'app-data'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({
      executablePath: process.env.LOADSTONE_TEST_EXE || require('electron'),
      args: process.env.LOADSTONE_TEST_EXE ? [] : [path.resolve('.')],
      env,
    });
    try {
      const page = await app.firstWindow();
      await page
        .getByRole('button', { name: 'Explore the demo', exact: true })
        .click();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await app.evaluate(({ dialog }, selected) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [selected],
        });
      }, file);
      const inspectButton = page.getByRole('button', {
        name: 'Inspect .loadstone package',
        exact: true,
      });
      await inspectButton.click();
      await page
        .getByText('Package integrity checked', { exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole('region', { name: 'Native package inspection' })
          .getByText('Fallout: New Vegas', { exact: true })
          .count(),
        1,
      );
      assert.deepEqual(
        await page.evaluate(() => window.loadstone.liveCatalog()),
        [],
      );
      assert.deepEqual(
        await page.evaluate(() => window.loadstone.liveJobs()),
        [],
      );
      assert.deepEqual(fs.readFileSync(file), before);
      fs.mkdirSync('test-results', { recursive: true });
      await page
        .getByRole('region', { name: 'Native package creator tools' })
        .screenshot({ path: 'test-results/native-package-preview.png' });
      const bad = path.join(f.root, 'damaged.loadstone');
      fs.writeFileSync(bad, 'not a package');
      await app.evaluate(({ dialog }, selected) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [selected],
        });
      }, bad);
      await inspectButton.click();
      await page
        .getByRole('alert')
        .filter({ hasText: 'The package could not be verified.' })
        .waitFor();
      assert.equal(
        await page
          .getByText('Package integrity checked', { exact: true })
          .count(),
        0,
      );
      await app.evaluate(({ dialog }) => {
        dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
      });
      await inspectButton.click();
      assert.equal(
        await page.evaluate(() => window.loadstone.inspectNativePackage()),
        null,
      );
    } finally {
      await app.close();
    }
  },
);

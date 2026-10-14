import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';
const require = createRequire(import.meta.url);
test(
  'first run opens native installation without an engine and remembers the real workspace',
  { timeout: 60000 },
  async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'loadstone-onboarding-'),
    );
    let app;
    const start = async () => {
      app = await electron.launch({
        executablePath: process.env.LOADSTONE_TEST_EXE || require('electron'),
        args: process.env.LOADSTONE_TEST_EXE
          ? []
          : [path.resolve(import.meta.dirname, '..')],
        env: { ...process.env, LOADSTONE_DATA_DIR: root },
      });
      return app.firstWindow();
    };
    try {
      let page = await start();
      await page
        .getByRole('heading', { name: 'Make room for another adventure.' })
        .waitFor();
      assert.equal(
        await page
          .getByRole('button', { name: 'Explore the demo', exact: true })
          .count(),
        1,
      );
      await page
        .getByText(
          'This preview installs creator-provided setups. No playable modlists are bundled yet.',
          { exact: true },
        )
        .waitFor();
      assert.equal(
        (await page.evaluate(() => window.loadstone.runtime())).status,
        'missing',
      );
      assert.equal(
        (await page.evaluate(() => window.loadstone.liveJobs())).length,
        0,
      );
      fs.mkdirSync('test-results', { recursive: true });
      await page.screenshot({ path: path.resolve('test-results/welcome.png') });
      await page
        .getByRole('button', { name: 'Set up real installations', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Open .loadstone', exact: true })
        .waitFor();
      const state = await page.evaluate(() => window.loadstone.getState());
      assert.equal(state.settings.onboardingComplete, true);
      assert.equal(state.settings.dummyData, false);
      assert.equal(
        (await page.evaluate(() => window.loadstone.runtime())).status,
        'missing',
      );
      await app.close();
      app = null;
      page = await start();
      await page
        .getByRole('heading', { name: 'No Wabbajack setups imported' })
        .waitFor();
      assert.equal(
        await page
          .getByRole('heading', { name: 'Make room for another adventure.' })
          .count(),
        0,
      );
      assert.equal(
        (await page.evaluate(() => window.loadstone.getState())).settings
          .dummyData,
        false,
      );
    } finally {
      if (app) await app.close();
    }
  },
);

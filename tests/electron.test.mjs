import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';
const require = createRequire(import.meta.url);
const electronPath = process.env.LOADSTONE_TEST_EXE || require('electron');
const { Store } = require('../electron/store.cjs');
const repo = path.resolve(import.meta.dirname, '..');
const artifacts = path.join(repo, 'test-results');
fs.mkdirSync(artifacts, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('demo engine guards live mode, queues installs, persists pauses, and preserves settings on reset', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-store-'));
  const store = new Store(folder);
  const options = {
    setupId: 'mojave',
    destination: path.join(folder, 'Mojave'),
    desktopShortcut: true,
    steamShortcut: true,
  };
  store.install(options);
  store.tick();
  assert.throws(() => store.install(options), /already has/);
  const restarted = new Store(folder);
  assert.equal(restarted.state.jobs[0].status, 'paused');
  restarted.settings({ dummyData: false });
  assert.throws(
    () => restarted.job('resume', restarted.state.jobs[0].id),
    /Enable dummy/,
  );
  assert.equal(restarted.tick(), false);
  restarted.settings({ dummyData: true });
  restarted.job('resume', restarted.state.jobs[0].id);
  for (let i = 0; i < 50; i++) restarted.tick();
  assert.equal(restarted.state.installed.length, 1);
  assert.throws(() => restarted.install(options), /already installed/);
  assert.equal(restarted.tick(), false);
  restarted.library('play', 'mojave');
  assert.equal(restarted.state.installed[0].sessions, 1);
  restarted.library('uninstall', 'mojave');
  assert.equal(restarted.state.installed.length, 0);
  restarted.settings({ reducedMotion: true });
  restarted.reset();
  assert.equal(restarted.state.settings.reducedMotion, true);
  assert.equal(restarted.state.jobs.length, 0);
  assert.throws(() => restarted.settings({ dummyData: 'yes' }), /Invalid/);
  assert.throws(
    () => restarted.settings({ installRoot: 'relative' }),
    /absolute/,
  );
  assert.throws(
    () => restarted.install({ ...options, setupId: 'unknown' }),
    /Unknown/,
  );
  assert.equal(
    fs.existsSync(options.destination),
    false,
    'demo must not create game folders',
  );
});

test(
  'packaged renderer in real Electron supports the complete demo review journey',
  { timeout: 180000 },
  async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-ui-'));
    const env = { ...process.env, LOADSTONE_DATA_DIR: dataDir };
    delete env.ELECTRON_RUN_AS_NODE;
    let app;
    const errors = [];
    const start = async () => {
      app = await electron.launch({
        executablePath: electronPath,
        args: process.env.LOADSTONE_TEST_EXE ? [] : [repo],
        env,
      });
      const page = await app.firstWindow();
      page.on('pageerror', (error) => errors.push(error.message));
      await page
        .getByRole('heading', { name: 'Your next playthrough, ready.' })
        .waitFor();
      return page;
    };
    try {
      let page = await start();
      assert.equal(
        await page.evaluate(() => typeof window.require),
        'undefined',
      );
      await page.screenshot({ path: path.join(artifacts, 'discover.png') });
      await page.getByRole('button', { name: 'Maximize window' }).click();
      await sleep(200);
      assert.equal(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isMaximized(),
        ),
        true,
      );
      await page.getByRole('button', { name: 'Maximize window' }).click();
      await page.getByRole('button', { name: 'Minimize window' }).click();
      await sleep(200);
      assert.equal(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isMinimized(),
        ),
        true,
      );
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].restore(),
      );
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1000, 700),
      );
      await sleep(200);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
        'minimum window size must not overflow horizontally',
      );
      await page.screenshot({ path: path.join(artifacts, 'compact.png') });
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1480, 980),
      );
      await page
        .getByRole('button', { name: 'Skyrim SE', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'Northern Paths', exact: true })
        .first()
        .waitFor();
      await page
        .getByRole('button', { name: 'All games', exact: true })
        .click();
      await page
        .getByRole('textbox', { name: 'Search setups' })
        .fill('Commonwealth');
      await page
        .getByRole('heading', { name: 'Commonwealth Renewed', exact: true })
        .first()
        .waitFor();
      await page
        .getByRole('textbox', { name: 'Search setups' })
        .fill('does-not-exist');
      await page.getByRole('heading', { name: 'No journeys found' }).waitFor();
      await page.getByRole('button', { name: 'Clear filters' }).click();
      await page.getByRole('button', { name: 'View setup details' }).click();
      await page.getByRole('dialog', { name: 'Setup details' }).waitFor();
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() =>
          Boolean(document.activeElement?.closest('[role="dialog"]')),
        ),
        true,
      );
      await page.keyboard.press('Shift+Tab');
      assert.equal(
        await page.evaluate(() =>
          Boolean(document.activeElement?.closest('[role="dialog"]')),
        ),
        true,
      );
      await page.screenshot({ path: path.join(artifacts, 'details.png') });
      await page.getByRole('button', { name: 'Close dialog' }).click();
      await page
        .getByRole('button', { name: 'Install setup', exact: true })
        .first()
        .click();
      await page
        .getByRole('dialog', { name: 'Prepare installation' })
        .waitFor();
      await page.screenshot({ path: path.join(artifacts, 'install.png') });
      await page
        .getByRole('button', { name: 'Begin demo installation' })
        .click();
      await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await page.getByText('Installation paused', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(artifacts, 'downloads.png') });
      const paused = await page.evaluate(() => window.loadstone.getState());
      await sleep(1000);
      assert.equal(
        (await page.evaluate(() => window.loadstone.getState())).jobs[0]
          .progress,
        paused.jobs[0].progress,
      );
      await app.close();
      page = await start();
      await page.getByRole('button', { name: /^Downloads/ }).click();
      await page.getByText('Installation paused', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
      await page
        .getByText('Ready to play', { exact: true })
        .waitFor({ timeout: 35000 });
      await page.getByRole('button', { name: 'Open library' }).click();
      await page
        .getByRole('heading', { name: 'Mojave Reforged', exact: true })
        .waitFor();
      await page.screenshot({ path: path.join(artifacts, 'library.png') });
      await page
        .getByRole('button', { name: 'Play demo', exact: true })
        .click();
      await page.getByRole('dialog', { name: 'Demo session' }).waitFor();
      await page.getByRole('button', { name: 'Back to my library' }).click();
      await page
        .getByRole('button', { name: 'Verify Mojave Reforged' })
        .click();
      await page
        .getByText('Demo verification passed. Your profile is ready.', {
          exact: true,
        })
        .waitFor();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const pickedDirectory = path.join(dataDir, 'chosen-folder');
      await app.evaluate(({ dialog }, directory) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [directory],
        });
      }, pickedDirectory);
      await page.getByRole('button', { name: 'Browse', exact: true }).click();
      await page
        .getByText('Installation folder saved.', { exact: true })
        .waitFor();
      assert.equal(
        (await page.evaluate(() => window.loadstone.getState())).settings
          .installRoot,
        pickedDirectory,
      );
      const exportedLog = path.join(dataDir, 'diagnostics.txt');
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, exportedLog);
      await page.getByRole('button', { name: 'Export diagnostics' }).click();
      await page
        .getByText(`Diagnostics exported to ${exportedLog}`, { exact: true })
        .waitFor();
      const reportText = fs.readFileSync(exportedLog, 'utf8');
      const report = JSON.parse(reportText);
      assert.equal(report.product, 'Loadstone');
      assert.equal(report.mode, 'demo');
      assert.ok(report.demo.activityLines > 0);
      assert.equal(reportText.includes(pickedDirectory), false);
      assert.match(report.build.lockfileSha256, /^[a-f0-9]{64}$/);
      await page.getByRole('switch', { name: 'Reduce motion' }).click();
      await page.getByRole('switch', { name: 'Use dummy data' }).click();
      await page.getByRole('button', { name: 'Discover', exact: true }).click();
      await page
        .getByRole('heading', { name: 'No live setups imported' })
        .waitFor();
      assert.equal(
        await page
          .getByRole('button', { name: 'Install setup', exact: true })
          .count(),
        0,
      );
      await page.screenshot({ path: path.join(artifacts, 'live-mode.png') });
      await assert.rejects(
        page.evaluate(() =>
          window.loadstone.install({
            setupId: 'northern',
            destination: 'C:\\fake',
            desktopShortcut: true,
            steamShortcut: true,
          }),
        ),
        /Enable dummy/,
      );
      await app.close();
      page = await start();
      await page
        .getByRole('heading', { name: 'No live setups imported' })
        .waitFor();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      assert.equal(
        await page
          .getByRole('switch', { name: 'Reduce motion' })
          .getAttribute('aria-checked'),
        'true',
      );
      await page.getByRole('switch', { name: 'Use dummy data' }).click();
      await page.screenshot({ path: path.join(artifacts, 'settings.png') });
      await page.getByRole('button', { name: /^My library/ }).click();
      await page
        .getByRole('heading', { name: 'Mojave Reforged', exact: true })
        .waitFor();
      await page
        .getByRole('button', { name: 'Uninstall Mojave Reforged' })
        .click();
      await page
        .getByRole('button', { name: 'Remove demo setup', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'Make room for your next story.' })
        .waitFor();
      await page.getByRole('button', { name: 'Discover setups' }).click();
      await page
        .getByRole('button', { name: 'Install setup', exact: true })
        .first()
        .click();
      await page
        .getByRole('button', { name: 'Begin demo installation' })
        .click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByText('Installation cancelled', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page
        .getByRole('button', { name: 'Reset demo workspace', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Reset demo data', exact: true })
        .click();
      const final = await page.evaluate(() => window.loadstone.getState());
      assert.equal(final.jobs.length, 0);
      assert.equal(final.installed.length, 0);
      assert.equal(final.settings.reducedMotion, true);
      assert.deepEqual(errors, []);
      fs.writeFileSync(
        path.join(artifacts, 'verification.json'),
        JSON.stringify(
          {
            passed: true,
            rendererErrors: errors,
            verified: new Date().toISOString(),
            workflows: [
              'discovery',
              'filtering',
              'search',
              'details',
              'install',
              'pause',
              'resume after restart',
              'completion',
              'library',
              'demo launch',
              'verification',
              'persistent settings',
              'dummy data isolation',
              'uninstall',
              'cancel',
              'retry',
              'reset',
            ],
          },
          null,
          2,
        ),
      );
    } finally {
      if (app) await app.close().catch(() => {});
    }
  },
);

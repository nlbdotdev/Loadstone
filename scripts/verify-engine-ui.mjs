import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-engine-ui-'));
let app;
const errors = [];
async function open() {
  app = await electron.launch({
    executablePath: process.env.LOADSTONE_TEST_EXE || require('electron'),
    args: process.env.LOADSTONE_TEST_EXE ? [] : [root],
    env: { ...process.env, LOADSTONE_DATA_DIR: dataDir },
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.loadstone));
  if (
    !(await page.evaluate(() => window.loadstone.getState())).settings
      .onboardingComplete
  )
    await page
      .getByRole('button', { name: 'Set up real installations', exact: true })
      .click();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Installation engine', exact: true })
    .waitFor();
  return page;
}
try {
  let page = await open();
  await page
    .getByRole('button', { name: 'Install engine', exact: true })
    .click();
  await page
    .getByText('Runtime verified', { exact: true })
    .waitFor({ timeout: 180000 });
  assert.equal(
    (await page.evaluate(() => window.loadstone.runtime())).status,
    'ready',
  );
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({
    path: path.join(root, 'test-results', 'engine-ready.png'),
  });
  await app.close();
  app = null;
  page = await open();
  await page
    .getByText('Runtime verified', { exact: true })
    .waitFor({ timeout: 30000 });
  await page
    .getByRole('button', { name: 'Verify engine', exact: true })
    .click();
  await page
    .getByText('Runtime verified', { exact: true })
    .waitFor({ timeout: 30000 });
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    dataDir,
    workflows: [
      'actual official download through native IPC',
      'pinned release extraction and CLI checks',
      'ready state in settings',
      'persisted engine verification after restart',
      'manual verification',
    ],
    rendererErrors: errors,
    verified: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(root, 'test-results', 'engine-ui-verification.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (app) await app.close();
}

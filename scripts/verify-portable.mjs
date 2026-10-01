import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const executable = path.join(root, 'release', 'Loadstone-0.1.0-Windows.exe');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-portable-'));
const server = net.createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const env = { ...process.env, LOADSTONE_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
const processHandle = spawn(
  executable,
  [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'],
  { env, windowsHide: true, stdio: 'ignore' },
);
let exited = false;
processHandle.on('exit', () => (exited = true));
processHandle.on('error', (error) => {
  throw error;
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 240; attempt++) {
    if (exited)
      throw new Error('Portable executable exited before the app opened.');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      ready = response.ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(ready, true, 'portable executable must open within 60 seconds');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  await page
    .getByRole('heading', { name: 'Your next playthrough, ready.' })
    .waitFor();
  assert.equal(
    (await page.evaluate(() => window.loadstone.getState())).settings.dummyData,
    true,
  );
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({
    path: path.join(root, 'test-results', 'portable-launch.png'),
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Use dummy data' }).click();
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Your next chapter starts here' })
    .waitFor();
  await page.evaluate(() => window.loadstone.window('close')).catch(() => {});
  await browser.close().catch(() => {});
  for (let attempt = 0; attempt < 120 && !exited; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(exited, true, 'portable app and wrapper must exit cleanly');
  fs.writeFileSync(
    path.join(root, 'test-results', 'portable-verification.json'),
    JSON.stringify(
      {
        executable,
        passed: true,
        verified: new Date().toISOString(),
        workflows: [
          'portable extraction and launch',
          'renderer load',
          'native bridge',
          'settings',
          'dummy-data isolation',
          'clean shutdown',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    'Portable Windows executable verified: launch, native bridge, settings, dummy-data isolation, and clean shutdown.',
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  if (!exited) processHandle.kill();
}

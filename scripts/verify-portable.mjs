import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
if (process.argv.length > 4)
  throw new Error(
    'Usage: node scripts/verify-portable.mjs [package-directory] [evidence-directory]',
  );
const packageDirectory = path.resolve(
  process.argv[2] || path.join(root, 'release'),
);
const evidenceDirectory = path.resolve(
  process.argv[3] || path.join(root, 'test-results'),
);
const { version } = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);
const executable = path.join(
  packageDirectory,
  `Loadstone-${version}-Windows.exe`,
);
const digest = crypto.createHash('sha256');
for await (const chunk of fs.createReadStream(executable)) digest.update(chunk);
const artifactHash = digest.digest('hex');
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
let exited = false,
  launchError;
processHandle.on('exit', () => (exited = true));
processHandle.on('error', (error) => {
  launchError = error;
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 240; attempt++) {
    if (launchError) throw launchError;
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
  const context = browser.contexts()[0];
  await context.setOffline(true);
  const page = context.pages()[0];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page
    .getByRole('button', { name: 'Explore the demo', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Your next playthrough, ready.' })
    .waitFor();
  assert.equal(
    (await page.evaluate(() => window.loadstone.getState())).settings.dummyData,
    true,
  );
  assert.equal(
    await page
      .getByRole('button', { name: `PREVIEW ${version}`, exact: true })
      .count(),
    1,
    'packaged UI must display the current package version',
  );
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(evidenceDirectory, 'portable-launch.png'),
  });
  await page
    .getByRole('button', { name: 'About Loadstone', exact: true })
    .click();
  const license = page.getByRole('region', { name: 'Loadstone license' });
  await license.getByText('Read license and scope', { exact: true }).click();
  const normalize = (text) => text.replace(/\r\n/g, '\n');
  const expectedLicense = ['COPYRIGHT', 'LICENSE']
    .map((file) => normalize(fs.readFileSync(path.join(root, file), 'utf8')))
    .join('\n\n');
  assert.equal(
    normalize(
      await license.getByLabel('License text', { exact: true }).inputValue(),
    ),
    expectedLicense,
    'portable app must display the complete current license and scope offline',
  );
  await page.getByRole('dialog', { name: 'About Loadstone' }).screenshot({
    path: path.join(evidenceDirectory, 'portable-license.png'),
  });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Use dummy data' }).click();
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  await page
    .getByRole('heading', { name: 'No live setups imported' })
    .waitFor();
  assert.deepEqual(
    pageErrors,
    [],
    'portable renderer must have no unhandled errors',
  );
  await page.evaluate(() => window.loadstone.window('close')).catch(() => {});
  await browser.close().catch(() => {});
  for (let attempt = 0; attempt < 120 && !exited; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(exited, true, 'portable app and wrapper must exit cleanly');
  fs.writeFileSync(
    path.join(evidenceDirectory, 'portable-verification.json'),
    JSON.stringify(
      {
        executable: path.basename(executable),
        version,
        sha256: artifactHash,
        bytes: fs.statSync(executable).size,
        passed: true,
        verified: new Date().toISOString(),
        workflows: [
          'portable extraction and launch',
          'renderer load',
          'native bridge',
          'current preview version',
          'complete GPL-3.0-or-later license and scope offline',
          'settings',
          'dummy-data isolation',
          'clean shutdown',
        ],
        licenseTextSha256: crypto
          .createHash('sha256')
          .update(expectedLicense)
          .digest('hex'),
      },
      null,
      2,
    ),
  );
  console.log(
    'Portable Windows executable verified: launch, native bridge, version, offline license, settings, dummy-data isolation, and clean shutdown.',
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  if (!exited) processHandle.kill();
}

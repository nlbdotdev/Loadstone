import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';
const require = createRequire(import.meta.url);
const { NexusAccount, ENDPOINT } = require('../electron/nexus.cjs');
const fixtureKey = 'loadstone-fixture-key-not-a-real-credential';
function storage() {
  const key = crypto.randomBytes(32),
    iv = crypto.randomBytes(16);
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'test',
    encryptString: (value) => {
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      return Buffer.concat([cipher.update(value), cipher.final()]);
    },
    decryptString: (bytes) => {
      const cipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      return Buffer.concat([cipher.update(bytes), cipher.final()]).toString();
    },
  };
}
const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-nexus-'));
test('Nexus stores only protected credentials and preserves them on validation or save failure', async () => {
  const root = folder(),
    protectedStorage = storage();
  let failure = 0;
  const account = new NexusAccount(
    root,
    protectedStorage,
    async (url, options) => {
      assert.equal(url, ENDPOINT);
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers['Application-Name'], 'Loadstone');
      return new Response(
        JSON.stringify({
          name: 'Fixture account',
          is_premium: true,
          key: options.headers.apikey,
          email: 'unused@example.com',
        }),
        { status: failure || 200 },
      );
    },
  );
  const connected = await account.connect(fixtureKey);
  assert.equal(connected.premium, true);
  assert.equal(JSON.stringify(connected).includes(fixtureKey), false);
  const bytes = fs.readFileSync(account.file);
  assert.equal(bytes.includes(Buffer.from(fixtureKey)), false);
  assert.equal(
    new NexusAccount(root, protectedStorage).status().name,
    'Fixture account',
  );
  failure = 401;
  await assert.rejects(account.verify(), /rejected/);
  failure = 429;
  await assert.rejects(account.verify(), /request limit/);
  assert.deepEqual(fs.readFileSync(account.file), bytes);
  failure = 0;
  protectedStorage.encryptString = () => {
    throw new Error(fixtureKey);
  };
  await assert.rejects(
    account.connect(fixtureKey),
    (error) =>
      !error.message.includes(fixtureKey) &&
      /Could not save/.test(error.message),
  );
  assert.deepEqual(fs.readFileSync(account.file), bytes);
  assert.equal(account.disconnect().connected, false);
  assert.equal(fs.existsSync(account.file), false);
});
test('Nexus fails closed on unavailable encryption, redirects/network errors, and malformed responses', async () => {
  const account = new NexusAccount(folder(), {
    isEncryptionAvailable: () => false,
  });
  await assert.rejects(account.connect(fixtureKey), /storage is unavailable/);
  for (const request of [
    async () => {
      throw new Error(fixtureKey);
    },
    async () => new Response('invalid json'),
    async () =>
      new Response(JSON.stringify({ name: 'User', is_premium: 'true' })),
  ]) {
    const testAccount = new NexusAccount(folder(), storage(), request);
    await assert.rejects(
      testAccount.connect(fixtureKey),
      (error) => !error.message.includes(fixtureKey),
    );
    assert.equal(fs.existsSync(testAccount.file), false);
  }
});
test(
  'real Electron encrypts the Nexus key, restores account status, and removes it on disconnect',
  { timeout: 60000 },
  async () => {
    const root = folder();
    let app;
    async function open() {
      app = await electron.launch({
        executablePath: process.env.LOADSTONE_TEST_EXE || require('electron'),
        args: process.env.LOADSTONE_TEST_EXE
          ? []
          : [path.resolve(import.meta.dirname, '..')],
        env: { ...process.env, LOADSTONE_DATA_DIR: root },
      });
      const page = await app.firstWindow();
      await page.waitForFunction(() => Boolean(window.loadstone));
      if (
        !(await page.evaluate(() => window.loadstone.getState())).settings
          .onboardingComplete
      )
        await page
          .getByRole('button', {
            name: 'Set up real installations',
            exact: true,
          })
          .click();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      return page;
    }
    try {
      let page = await open();
      await app.evaluate(() => {
        globalThis.fetch = async () =>
          new Response(
            JSON.stringify({ name: 'Fixture account', is_premium: false }),
          );
      });
      await page
        .getByLabel('Personal API key', { exact: true })
        .fill(fixtureKey);
      await page
        .getByRole('button', { name: 'Connect Nexus', exact: true })
        .click();
      await page.getByText('Fixture account', { exact: true }).waitFor();
      assert.equal(
        await page.getByText('Free membership', { exact: true }).isVisible(),
        true,
      );
      const bytes = fs.readFileSync(path.join(root, 'nexus.bin'));
      assert.equal(bytes.includes(Buffer.from(fixtureKey)), false);
      const state = await page.evaluate(async () =>
        JSON.stringify({
          account: await window.loadstone.nexus(),
          state: await window.loadstone.getState(),
        }),
      );
      assert.equal(state.includes(fixtureKey), false);
      await app.close();
      app = null;
      page = await open();
      await page.getByText('Fixture account', { exact: true }).waitFor();
      await page
        .getByRole('button', { name: 'Disconnect Nexus', exact: true })
        .click();
      await page.getByLabel('Personal API key', { exact: true }).waitFor();
      assert.equal(fs.existsSync(path.join(root, 'nexus.bin')), false);
    } finally {
      if (app) await app.close();
    }
  },
);

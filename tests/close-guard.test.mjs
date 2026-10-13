import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';
const require = createRequire(import.meta.url);
const {
  protectActiveWork,
  currentActivity,
} = require('../electron/close-guard.cjs');

test('close guard covers preparation, installation, verification, removal and engine preparation', async () => {
  const app = new EventEmitter(),
    window = new EventEmitter();
  window.isDestroyed = () => false;
  window.minimize = () => {};
  const installer = {},
    runtime = {},
    nativeBuilder = {},
    nativeLibrary = {};
  let prompts = 0;
  protectActiveWork(
    app,
    window,
    {
      showMessageBox: async () => {
        prompts++;
        return { response: 0 };
      },
    },
    () => currentActivity(installer, runtime, nativeBuilder, nativeLibrary),
  );
  for (const [object, key] of [
    [installer, 'starting'],
    [installer, 'running'],
    [installer, 'maintenance'],
    [runtime, 'controller'],
    [nativeBuilder, 'busy'],
    [nativeLibrary, 'busy'],
  ]) {
    object[key] = true;
    for (const [target, event] of [
      [window, 'close'],
      [app, 'before-quit'],
    ]) {
      let prevented = false;
      target.emit(event, {
        preventDefault() {
          prevented = true;
        },
      });
      assert.equal(prevented, true, key);
      await new Promise((resolve) => setImmediate(resolve));
    }
    object[key] = false;
  }
  assert.equal(prompts, 12);
  window.emit('close', {
    preventDefault() {
      assert.fail('Idle close must be allowed');
    },
  });
  window.emit('closed');
  assert.equal(app.listenerCount('before-quit'), 0);
});

test('repeated close requests do not stack dialogs or replay a stale quit after work finishes', async () => {
  const app = new EventEmitter(),
    window = new EventEmitter();
  window.isDestroyed = () => false;
  let resolveDialog,
    prompts = 0,
    busy = true,
    minimized = 0;
  window.minimize = () => minimized++;
  protectActiveWork(
    app,
    window,
    {
      showMessageBox: () => {
        prompts++;
        return new Promise((resolve) => {
          resolveDialog = resolve;
        });
      },
    },
    () => (busy ? { message: 'Busy', detail: 'Wait' } : null),
  );
  let prevented = 0;
  window.emit('close', {
    preventDefault() {
      prevented++;
    },
  });
  app.emit('before-quit', {
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(prevented, 2);
  assert.equal(prompts, 1);
  busy = false;
  resolveDialog({ response: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(minimized, 1);
  window.emit('close', {
    preventDefault() {
      assert.fail('Idle close must be allowed');
    },
  });
});

test(
  'real Electron window close and app quit preserve active work until idle',
  { timeout: 60000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loadstone-close-'));
    let instance;
    try {
      instance = await electron.launch({
        executablePath: process.env.LOADSTONE_TEST_EXE || require('electron'),
        args: process.env.LOADSTONE_TEST_EXE
          ? []
          : [path.resolve(import.meta.dirname, '..')],
        env: { ...process.env, LOADSTONE_DATA_DIR: root },
      });
      await instance.firstWindow();
      await instance.evaluate(({ app, BrowserWindow }) => {
        const { protectActiveWork, currentActivity } =
          process.mainModule.require(
            app.getAppPath() + '/electron/close-guard.cjs',
          );
        globalThis.closeFixture = {
          installer: { running: {} },
          runtime: {},
          prompts: 0,
        };
        const fixture = globalThis.closeFixture;
        protectActiveWork(
          app,
          BrowserWindow.getAllWindows()[0],
          {
            showMessageBox: async () => {
              fixture.prompts++;
              return { response: 0 };
            },
          },
          () => currentActivity(fixture.installer, fixture.runtime),
        );
        BrowserWindow.getAllWindows()[0].close();
      });
      assert.deepEqual(
        await instance.evaluate(({ BrowserWindow }) => ({
          windows: BrowserWindow.getAllWindows().length,
          prompts: globalThis.closeFixture.prompts,
        })),
        { windows: 1, prompts: 1 },
      );
      await instance.evaluate(({ app }) => app.quit());
      assert.deepEqual(
        await instance.evaluate(({ BrowserWindow }) => ({
          windows: BrowserWindow.getAllWindows().length,
          prompts: globalThis.closeFixture.prompts,
        })),
        { windows: 1, prompts: 2 },
      );
      await instance.evaluate(() => {
        globalThis.closeFixture.installer.running = null;
      });
      await instance.close();
      instance = null;
    } finally {
      if (instance) {
        await instance
          .evaluate(() => {
            if (globalThis.closeFixture)
              globalThis.closeFixture.installer.running = null;
          })
          .catch(() => {});
        await instance.close();
      }
    }
  },
);

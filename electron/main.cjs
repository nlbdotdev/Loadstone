const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  shell,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Store } = require('./store.cjs');
const { LiveCatalog } = require('./live-catalog.cjs');
const { steamRoots, discoverGames } = require('./game-discovery.cjs');
const { Runtime } = require('./runtime.cjs');
const { NexusAccount } = require('./nexus.cjs');
const { Installer } = require('./installer.cjs');
const { Launcher } = require('./launcher.cjs');
const { createDesktopShortcut } = require('./shortcuts.cjs');
const { SteamShortcuts } = require('./steam-shortcuts.cjs');
const { diagnostics } = require('./diagnostics.cjs');
const { Maintenance } = require('./maintenance.cjs');
let window, store, timer, live, runtime, nexus, installer, launcher;
if (process.env.LOADSTONE_DATA_DIR)
  app.setPath('userData', path.resolve(process.env.LOADSTONE_DATA_DIR));
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(() => {
      store = new Store(app.getPath('userData'));
      live = new LiveCatalog(app.getPath('userData'));
      runtime = new Runtime(app.getPath('userData'));
      nexus = new NexusAccount(app.getPath('userData'), safeStorage);
      installer = new Installer(app.getPath('userData'), live, runtime, nexus);
      launcher = new Launcher(installer);
      const maintenance = new Maintenance(installer);
      const steamShortcuts = new SteamShortcuts();
      const steamShortcut = async (id, accountId) => {
        const result = await steamShortcuts.create(
          installer.jobs.find((item) => item.id === id),
          accountId,
        );
        installer.change(id, {
          steamShortcut: result,
          steamShortcutError: null,
        });
        return result;
      };
      const desktopShortcut = (id) => {
        const job = installer.jobs.find((item) => item.id === id);
        const file = createDesktopShortcut(job, app.getPath('desktop'), shell);
        installer.change(id, { desktopShortcut: file, shortcutError: null });
        return file;
      };
      installer.onInstalled = async (id) => {
        if (store.state.settings.desktopShortcut) {
          try {
            desktopShortcut(id);
          } catch (error) {
            installer.change(id, { shortcutError: error.message });
          }
        }
        if (store.state.settings.steamShortcut) {
          try {
            const accounts = await steamShortcuts.list();
            if (accounts.length !== 1)
              throw new Error(
                'Choose a local Steam account from the setup’s library controls.',
              );
            await steamShortcut(id, accounts[0].id);
          } catch (error) {
            installer.change(id, { steamShortcutError: error.message });
          }
        }
      };
      void runtime.verify();
      window = new BrowserWindow({
        width: 1480,
        height: 980,
        minWidth: 1000,
        minHeight: 700,
        frame: false,
        backgroundColor: '#151819',
        title: 'Loadstone',
        icon: path.join(__dirname, '../dist/icon.png'),
        show: false,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.once('ready-to-show', () => window.show());
      window.loadFile(path.join(__dirname, '../dist/index.html'));
      const trusted = (event) => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error('Untrusted IPC sender.');
      };
      const notify = () => {
        if (!window.isDestroyed())
          window.webContents.send('state:changed', store.state);
      };
      const handle = (channel, fn) =>
        ipcMain.handle(channel, async (event, ...args) => {
          trusted(event);
          const result = await fn(...args);
          notify();
          return result;
        });
      handle('state:get', () => store.state);
      handle('settings:update', (patch) => store.settings(patch));
      handle('demo:install', (options) => store.install(options));
      handle('demo:job', (action, id) => store.job(action, id));
      handle('demo:library', (action, id) => store.library(action, id));
      handle('demo:reset', () => store.reset());
      handle('live:catalog', () => live.list());
      handle('live:install-root', () => {
        const root = store.state.settings.installRoot;
        const relative = path.relative(app.getPath('userData'), root);
        return relative === '' ||
          (!relative.startsWith('..' + path.sep) &&
            relative !== '..' &&
            !path.isAbsolute(relative))
          ? path.join(app.getPath('documents'), 'Loadstone', 'Setups')
          : root;
      });
      handle('live:games', async () => discoverGames(await steamRoots()));
      handle('runtime:get', () => runtime.status());
      handle('nexus:get', () => nexus.status());
      handle('nexus:connect', (key) => nexus.connect(key));
      handle('nexus:verify', () => nexus.verify());
      handle('nexus:disconnect', () => nexus.disconnect());
      handle('runtime:verify', () => runtime.verify());
      handle('runtime:install', () => runtime.install());
      handle('runtime:cancel', () => runtime.cancel());
      handle('live:preflight', (options) => installer.preflight(options));
      handle('live:jobs', () => launcher.list());
      handle('live:remove', async (id) => {
        if (store.state.settings.dummyData)
          throw new Error(
            'Switch to the live workspace before removing a setup.',
          );
        const plan = await maintenance.preview(id);
        const result = await dialog.showMessageBox(window, {
          type: 'warning',
          title: 'Remove installed setup files?',
          message: `Remove ${plan.files} installed files (${(plan.bytes / 1e9).toFixed(2)} GB)?`,
          detail: `Setup: ${plan.destination}\n\nProfiles, saves folders, overwrite files, ModOrganizer.ini, downloads and files outside the profile folder are retained here:\n${plan.recovery}\n\nOther files inside the profile folder, including custom mods, will be deleted. Global game saves are not changed. Desktop and Steam shortcuts may need to be removed manually.`,
          buttons: ['Cancel', 'Remove installed files'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (result.response !== 1) return launcher.list();
        if (store.state.settings.dummyData)
          throw new Error('Return to the live workspace to continue.');
        return maintenance.remove(id);
      });
      handle('steam:accounts', () => steamShortcuts.list());
      handle('live:steam-shortcut', (id, accountId) => {
        if (store.state.settings.dummyData)
          throw new Error(
            'Switch to the live workspace before adding a Steam entry.',
          );
        return steamShortcut(id, accountId);
      });
      handle('live:desktop-shortcut', (id) => {
        if (store.state.settings.dummyData)
          throw new Error(
            'Switch to the live workspace before creating a shortcut.',
          );
        desktopShortcut(id);
        return launcher.list();
      });
      handle('live:launch', (id) => {
        if (store.state.settings.dummyData)
          throw new Error(
            'Switch to the live workspace before launching a setup.',
          );
        return launcher.launch(id);
      });
      handle('live:verify-profile', (id) => {
        launcher.verify(id);
        return 'The portable mod manager, declared profile and launch entry passed structural checks.';
      });
      handle('live:install', (options) => {
        if (store.state.settings.dummyData)
          throw new Error(
            'Switch to the live workspace before installing a real setup.',
          );
        return installer.start(options);
      });
      handle('live:retry', (id) => {
        if (store.state.settings.dummyData)
          throw new Error(
            'Switch to the live workspace before retrying a real setup.',
          );
        return installer.start(null, id);
      });
      handle('live:cancel', (id) => installer.cancel(id));
      handle('live:import', async () => {
        const result = await dialog.showOpenDialog(window, {
          title: 'Import a Loadstone setup manifest',
          properties: ['openFile'],
          filters: [{ name: 'Loadstone manifest', extensions: ['json'] }],
        });
        return result.canceled ? null : live.import(result.filePaths[0]);
      });
      handle('dialog:directory', async () => {
        const result = await dialog.showOpenDialog(window, {
          title: 'Choose setup installation folder',
          properties: ['openDirectory', 'createDirectory'],
        });
        return result.canceled ? null : result.filePaths[0];
      });
      handle('logs:export', async () => {
        const result = await dialog.showSaveDialog(window, {
          title: 'Export Loadstone diagnostics',
          defaultPath: 'loadstone-diagnostics.json',
          filters: [{ name: 'JSON report', extensions: ['json'] }],
        });
        if (result.canceled || !result.filePath) return null;
        fs.writeFileSync(
          result.filePath,
          JSON.stringify(
            diagnostics({
              state: store.state,
              engine: runtime.status(),
              account: nexus.status(),
              jobs: launcher.list(),
            }),
            null,
            2,
          ) + '\n',
        );
        return result.filePath;
      });
      ipcMain.on('window:action', (event, action) => {
        trusted(event);
        if (action === 'minimize') window.minimize();
        if (action === 'maximize')
          window.isMaximized() ? window.unmaximize() : window.maximize();
        if (action === 'close') window.close();
      });
      timer = setInterval(() => {
        try {
          if (store.tick()) notify();
        } catch (error) {
          clearInterval(timer);
          dialog.showErrorBox(
            'Loadstone could not save your workspace',
            'Installation progress has stopped. Free disk space or restore access to your workspace folder, then restart Loadstone.\n\n' +
              error.message,
          );
        }
      }, 400);
    })
    .catch((error) => {
      dialog.showErrorBox(
        'Loadstone could not open your workspace',
        error.message,
      );
      app.exit(1);
    });
  app.on('window-all-closed', async () => {
    if (installer?.running)
      await installer.cancel(installer.running.id).catch(() => {});
    runtime?.cancel();
    clearInterval(timer);
    app.quit();
  });
}

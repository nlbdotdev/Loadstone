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
const { protectActiveWork, currentActivity } = require('./close-guard.cjs');
const { LiveCatalog, contains, canonical } = require('./live-catalog.cjs');
const { steamRoots, discoverGames } = require('./game-discovery.cjs');
const { Runtime } = require('./runtime.cjs');
const { NexusAccount } = require('./nexus.cjs');
const { Installer } = require('./installer.cjs');
const { Launcher } = require('./launcher.cjs');
const {
  createDesktopShortcut,
  removeDesktopShortcut,
} = require('./shortcuts.cjs');
const { SteamShortcuts } = require('./steam-shortcuts.cjs');
const { diagnostics } = require('./diagnostics.cjs');
const { Maintenance } = require('./maintenance.cjs');
const { createNativePreview } = require('./native-preview.cjs');
const { NativeBuilder } = require('./native-builder.cjs');
const { NativeLibrary, nativeLaunchPlan } = require('./native-library.cjs');
const { NativeMaintenance } = require('./native-maintenance.cjs');
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
      const nativeRoots = (except) =>
        nativeLibrary.entries
          .filter((v) => v.id !== except)
          .flatMap((v) => [
            v.root,
            ...(v.recoveryRoot ? [v.recoveryRoot] : []),
          ]);
      store = new Store(app.getPath('userData'));
      live = new LiveCatalog(
        app.getPath('userData'),
        [
          app.isPackaged
            ? path.dirname(process.execPath)
            : path.resolve(__dirname, '..'),
        ],
        () => nativeRoots(),
      );
      runtime = new Runtime(app.getPath('userData'));
      nexus = new NexusAccount(app.getPath('userData'), safeStorage);
      installer = new Installer(app.getPath('userData'), live, runtime, nexus);
      launcher = new Launcher(installer);
      const maintenance = new Maintenance(installer);
      const nativePreview = createNativePreview();
      const nativeBuilder = new NativeBuilder(app.getPath('userData'), {
        nexus,
        assertAvailable: () => {
          if (store.state.settings.dummyData)
            throw new Error(
              'Switch to the live workspace before reconstructing real files.',
            );
          if (
            installer.starting ||
            installer.running ||
            installer.maintenance ||
            runtime.controller ||
            nativeLibrary.busy
          )
            throw new Error(
              'Wait for the current installation, removal or engine preparation.',
            );
        },
        protectedRoots: () => [
          app.isPackaged
            ? path.dirname(process.execPath)
            : path.resolve(__dirname, '..'),
          ...installer.jobs.map((v) => v.destination).filter(Boolean),
          ...nativeRoots(),
        ],
      });
      const nativeLibrary = new NativeLibrary(app.getPath('userData'), {
        assertAvailable: () => {
          if (store.state.settings.dummyData)
            throw new Error(
              'Switch to the live workspace to manage native setups.',
            );
          if (
            nativeBuilder.busy ||
            installer.starting ||
            installer.running ||
            installer.maintenance ||
            runtime.controller
          )
            throw new Error('Wait for installation or maintenance to finish.');
        },
        checkRoot: (root) => {
          const selected = canonical(root);
          const protectedRoots = [
            app.getPath('userData'),
            app.isPackaged
              ? path.dirname(process.execPath)
              : path.resolve(__dirname, '..'),
            ...installer.jobs.map((v) => v.destination).filter(Boolean),
            ...nativeRoots(),
          ];
          if (
            protectedRoots.some(
              (v) =>
                contains(canonical(v), selected) ||
                contains(selected, canonical(v)),
            )
          )
            throw new Error(
              'Choose a separate native candidate outside application data and existing installations.',
            );
        },
      });
      const idleNative = () => {
        if (nativeBuilder.busy || nativeLibrary.busy)
          throw new Error(
            'Wait for the native build or library operation to finish.',
          );
      };
      const steamShortcuts = new SteamShortcuts();
      const nativeMaintenance = new NativeMaintenance(nativeLibrary, {
        protectedRoots: (id) => [
          app.isPackaged
            ? path.dirname(process.execPath)
            : path.resolve(__dirname, '..'),
          ...installer.jobs.map((v) => v.destination).filter(Boolean),
          ...nativeRoots(id),
        ],
      });
      const cleanupNativeShortcuts = async (id) => {
        nativeLibrary.available();
        const entry = nativeLibrary.record(id);
        if (entry.status !== 'removed')
          throw new Error('Only removed native setups can clean up shortcuts.');
        nativeLibrary.busy = true;
        try {
          const errors = [];
          try {
            removeDesktopShortcut(entry, app.getPath('desktop'), shell);
          } catch (error) {
            errors.push(error.message);
          }
          try {
            await steamShortcuts.remove(entry);
          } catch (error) {
            errors.push(error.message);
          }
          nativeLibrary.change(id, {
            shortcutsCleaned: !errors.length,
            shortcutError:
              errors
                .join(' ')
                .replace(/[\x00-\x1f]/g, ' ')
                .slice(0, 2000) || null,
          });
          return nativeLibrary.list();
        } finally {
          nativeLibrary.busy = false;
        }
      };
      const cleanupShortcuts = async (id) => {
        if (store.state.settings.dummyData)
          throw new Error(
            'Switch to the live workspace before cleaning up shortcuts.',
          );
        const job = installer.jobs.find((item) => item.id === id);
        if (job?.status !== 'removed')
          throw new Error('Only removed setups can clean up shortcuts.');
        const errors = [];
        try {
          removeDesktopShortcut(job, app.getPath('desktop'), shell);
        } catch (error) {
          errors.push(error.message);
        }
        try {
          await steamShortcuts.remove(job);
        } catch (error) {
          errors.push(error.message);
        }
        installer.change(id, {
          shortcutCleanupError: errors.join(' ') || null,
          shortcutsCleaned: !errors.length,
        });
        return launcher.list();
      };
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
      protectActiveWork(app, window, dialog, () =>
        currentActivity(installer, runtime, nativeBuilder, nativeLibrary),
      );
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
      handle('native:inspect', () =>
        nativePreview(async () => {
          const result = await dialog.showOpenDialog(window, {
            title: 'Inspect a native Loadstone package',
            properties: ['openFile'],
            filters: [{ name: 'Loadstone package', extensions: ['loadstone'] }],
          });
          return result.canceled ? null : result.filePaths[0];
        }),
      );
      handle('native:builds', () => nativeBuilder.list());
      handle('native:prepare', () =>
        nativeBuilder.prepare(
          async () => {
            const chooseFile = async (title, name, extensions) => {
              const result = await dialog.showOpenDialog(window, {
                title,
                properties: ['openFile'],
                filters: [{ name, extensions }],
              });
              return result.canceled ? null : result.filePaths[0];
            };
            const packageFile = await chooseFile(
              'Choose a native package to reconstruct',
              'Loadstone package',
              ['loadstone'],
            );
            if (!packageFile) return null;
            const inputsFile = await chooseFile(
              'Choose the private local-inputs JSON',
              'Local inputs',
              ['json'],
            );
            if (!inputsFile) return null;
            const parent = await dialog.showOpenDialog(window, {
              title: 'Choose a parent folder for the new candidate',
              properties: ['openDirectory'],
            });
            return parent.canceled
              ? null
              : { packageFile, inputsFile, parent: parent.filePaths[0] };
          },
          async () => {
            const result = await dialog.showOpenDialog(window, {
              title: 'Select your trusted 7z.exe (7-Zip x64 26.04 or newer)',
              properties: ['openFile'],
              filters: [{ name: '7-Zip executable', extensions: ['exe'] }],
            });
            return result.canceled ? null : result.filePaths[0];
          },
        ),
      );
      handle('native:start', (id) => nativeBuilder.start(id));
      handle('native:cancel', (id) => nativeBuilder.cancel(id));
      handle('native-library:list', () => nativeLibrary.list());
      handle('native-library:prepare', () =>
        nativeLibrary.prepare(async () => {
          const result = await dialog.showOpenDialog(window, {
            title: 'Choose a completed native candidate',
            properties: ['openDirectory'],
          });
          return result.canceled ? null : result.filePaths[0];
        }),
      );
      handle('native-library:register', (id) => nativeLibrary.register(id));
      handle('native-library:verify', (id) => nativeLibrary.verify(id));
      handle('native-library:cancel', () => nativeLibrary.cancel());
      handle('native-library:launch', (id) => nativeLibrary.launch(id));
      handle('native-library:cleanup-shortcuts', cleanupNativeShortcuts);
      handle('native-library:remove', async (id) => {
        const plan = await nativeMaintenance.preview(id);
        const result = await dialog.showMessageBox(window, {
          type: 'warning',
          title: 'Remove native setup files?',
          message: `Remove up to ${plan.files} unchanged recipe files (${(plan.bytes / 1e9).toFixed(2)} GB)?`,
          detail: `Setup: ${plan.destination}\n\n${plan.preserved} other files were found and will be kept, including saves, profiles, configuration, downloads, modified files and untracked content. Files changed after this review will also be kept.\n\nThe candidate will be moved to this recovery folder before deletion:\n${plan.recovery}\n\nKeep games and MO2 closed. Loadstone will clean up its owned shortcuts; exit Steam to permit Steam cleanup, which can be retried afterwards.`,
          buttons: ['Cancel', 'Remove reviewed files'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (result.response !== 1) return nativeLibrary.list();
        await nativeMaintenance.remove(plan.id);
        return cleanupNativeShortcuts(id);
      });
      handle('native-library:desktop', (id) => {
        const job = nativeLibrary.shortcutJob(id);
        createDesktopShortcut(
          job,
          app.getPath('desktop'),
          shell,
          nativeLaunchPlan,
        );
        return 'Desktop shortcut created. It opens this candidate’s declared MO2 profile.';
      });
      handle('native-library:steam', async (id, accountId) => {
        const job = nativeLibrary.shortcutJob(id);
        nativeLibrary.busy = true;
        try {
          return await steamShortcuts.create(job, accountId, nativeLaunchPlan);
        } finally {
          nativeLibrary.busy = false;
        }
      });
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
      handle('runtime:install', () => {
        idleNative();
        return runtime.install();
      });
      handle('runtime:cancel', () => runtime.cancel());
      handle('live:preflight', (options) => installer.preflight(options));
      handle('live:jobs', () => launcher.list());
      handle('live:cleanup-shortcuts', cleanupShortcuts);
      handle('live:remove', async (id) => {
        idleNative();
        if (store.state.settings.dummyData)
          throw new Error(
            'Switch to the live workspace before removing a setup.',
          );
        const plan = await maintenance.preview(id);
        const result = await dialog.showMessageBox(window, {
          type: 'warning',
          title: 'Remove installed setup files?',
          message: `Remove ${plan.files} installed files (${(plan.bytes / 1e9).toFixed(2)} GB)?`,
          detail: `Setup: ${plan.destination}\n\nProfiles, saves folders, overwrite files, ModOrganizer.ini, downloads and files outside the profile folder are retained here:\n${plan.recovery}\n\nOther files inside the profile folder, including custom mods, will be deleted. Global game saves are not changed. Loadstone will remove its owned desktop and Steam shortcuts. Exit Steam to allow Steam shortcut cleanup; cleanup can be retried afterwards.`,
          buttons: ['Cancel', 'Remove installed files'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (result.response !== 1) return launcher.list();
        idleNative();
        if (store.state.settings.dummyData)
          throw new Error('Return to the live workspace to continue.');
        await maintenance.remove(id);
        return cleanupShortcuts(id);
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
        idleNative();
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
        idleNative();
        if (store.state.settings.dummyData)
          throw new Error(
            'Switch to the live workspace before installing a real setup.',
          );
        return installer.start(options);
      });
      handle('live:retry', (id) => {
        idleNative();
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
        if (result.canceled) return null;
        const file = result.filePaths[0];
        const candidate = live.inspectImport(file);
        if (candidate.previous) {
          const answer = await dialog.showMessageBox(window, {
            type: 'warning',
            title: 'Replace catalog version?',
            message: `Use ${candidate.manifest.name} ${candidate.manifest.version} instead of ${candidate.previous.version}?`,
            detail: `Creator: ${candidate.manifest.author}\nSource: ${candidate.manifest.website}\n\nSave compatibility: ${candidate.manifest.update.saveCompatibility}\n${candidate.manifest.update.notes}\n\nExisting installations stay intact. Install this version in a separate empty folder. Saves and custom changes are not copied automatically.`,
            buttons: ['Cancel', 'Replace catalog version'],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (answer.response !== 1) return null;
        }
        if (installer.starting || installer.running || installer.maintenance)
          throw new Error(
            'Wait for the current installation or removal before changing the catalog.',
          );
        return live.import(file, candidate);
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
  app.on('window-all-closed', () => {
    clearInterval(timer);
    app.quit();
  });
}

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Store } = require('./store.cjs');
let window, store, timer;
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
  app.whenReady().then(() => {
    store = new Store(app.getPath('userData'));
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
    handle('dialog:directory', async () => {
      const result = await dialog.showOpenDialog(window, {
        title: 'Choose setup installation folder',
        properties: ['openDirectory', 'createDirectory'],
      });
      return result.canceled ? null : result.filePaths[0];
    });
    handle('logs:export', async () => {
      const result = await dialog.showSaveDialog(window, {
        title: 'Export Loadstone logs',
        defaultPath: 'loadstone-diagnostics.txt',
        filters: [{ name: 'Text file', extensions: ['txt'] }],
      });
      if (result.canceled || !result.filePath) return null;
      fs.writeFileSync(
        result.filePath,
        [
          'Loadstone 0.1.0 — UI MVP',
          `Mode: ${store.state.settings.dummyData ? 'demo' : 'production (not connected)'}`,
          ...store.state.logs,
        ].join('\n'),
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
      if (store.tick()) notify();
    }, 400);
  });
  app.on('window-all-closed', () => {
    clearInterval(timer);
    app.quit();
  });
}

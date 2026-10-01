const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('loadstone', {
  getState: () => ipcRenderer.invoke('state:get'),
  settings: (patch) => ipcRenderer.invoke('settings:update', patch),
  install: (options) => ipcRenderer.invoke('demo:install', options),
  job: (action, id) => ipcRenderer.invoke('demo:job', action, id),
  library: (action, id) => ipcRenderer.invoke('demo:library', action, id),
  resetDemo: () => ipcRenderer.invoke('demo:reset'),
  pickDirectory: () => ipcRenderer.invoke('dialog:directory'),
  exportLogs: () => ipcRenderer.invoke('logs:export'),
  window: (action) => ipcRenderer.send('window:action', action),
  onState: (callback) => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on('state:changed', listener);
    return () => ipcRenderer.removeListener('state:changed', listener);
  },
});

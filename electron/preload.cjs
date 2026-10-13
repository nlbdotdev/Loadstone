const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('loadstone', {
  getState: () => ipcRenderer.invoke('state:get'),
  settings: (patch) => ipcRenderer.invoke('settings:update', patch),
  install: (options) => ipcRenderer.invoke('demo:install', options),
  job: (action, id) => ipcRenderer.invoke('demo:job', action, id),
  library: (action, id) => ipcRenderer.invoke('demo:library', action, id),
  resetDemo: () => ipcRenderer.invoke('demo:reset'),
  liveCatalog: () => ipcRenderer.invoke('live:catalog'),
  liveInstallRoot: () => ipcRenderer.invoke('live:install-root'),
  runtime: () => ipcRenderer.invoke('runtime:get'),
  nexus: () => ipcRenderer.invoke('nexus:get'),
  connectNexus: (key) => ipcRenderer.invoke('nexus:connect', key),
  verifyNexus: () => ipcRenderer.invoke('nexus:verify'),
  disconnectNexus: () => ipcRenderer.invoke('nexus:disconnect'),
  installRuntime: () => ipcRenderer.invoke('runtime:install'),
  verifyRuntime: () => ipcRenderer.invoke('runtime:verify'),
  cancelRuntime: () => ipcRenderer.invoke('runtime:cancel'),
  importManifest: () => ipcRenderer.invoke('live:import'),
  inspectNativePackage: () => ipcRenderer.invoke('native:inspect'),
  nativeBuilds: () => ipcRenderer.invoke('native:builds'),
  nativeGuide: () => ipcRenderer.invoke('native-guide:get'),
  repairNativeSetup: (id) => ipcRenderer.invoke('native-library:repair', id),
  updateNativeSetup: (id) => ipcRenderer.invoke('native-library:update', id),
  importNativeSetup: (resumeId) =>
    ipcRenderer.invoke('native-guide:import', resumeId),
  selectNativeInput: (id, kind, key, token) =>
    ipcRenderer.invoke('native-guide:select', id, kind, key, token),
  reviewNativeSetup: (id) => ipcRenderer.invoke('native-guide:review', id),
  installNativeSetup: (id, planId) =>
    ipcRenderer.invoke('native-guide:start', id, planId),
  admitNativeBuild: (id) => ipcRenderer.invoke('native:admit', id),
  prepareNativeBuild: () => ipcRenderer.invoke('native:prepare'),
  resumeNativeBuild: (id) => ipcRenderer.invoke('native:resume', id),
  startNativeBuild: (id) => ipcRenderer.invoke('native:start', id),
  cancelNativeBuild: (id) => ipcRenderer.invoke('native:cancel', id),
  nativeLibrary: () => ipcRenderer.invoke('native-library:list'),
  prepareNativeLibrary: () => ipcRenderer.invoke('native-library:prepare'),
  registerNativeLibrary: (id) =>
    ipcRenderer.invoke('native-library:register', id),
  verifyNativeLibrary: (id) => ipcRenderer.invoke('native-library:verify', id),
  cancelNativeVerification: () => ipcRenderer.invoke('native-library:cancel'),
  launchNative: (id) => ipcRenderer.invoke('native-library:launch', id),
  removeNative: (id) => ipcRenderer.invoke('native-library:remove', id),
  cleanupNativeShortcuts: (id) =>
    ipcRenderer.invoke('native-library:cleanup-shortcuts', id),
  nativeDesktopShortcut: (id) =>
    ipcRenderer.invoke('native-library:desktop', id),
  nativeSteamShortcut: (id, accountId) =>
    ipcRenderer.invoke('native-library:steam', id, accountId),
  discoverGames: () => ipcRenderer.invoke('live:games'),
  preflight: (options) => ipcRenderer.invoke('live:preflight', options),
  liveJobs: () => ipcRenderer.invoke('live:jobs'),
  cleanupShortcuts: (id) => ipcRenderer.invoke('live:cleanup-shortcuts', id),
  removeLive: (id) => ipcRenderer.invoke('live:remove', id),
  steamAccounts: () => ipcRenderer.invoke('steam:accounts'),
  steamShortcut: (id, accountId) =>
    ipcRenderer.invoke('live:steam-shortcut', id, accountId),
  desktopShortcut: (id) => ipcRenderer.invoke('live:desktop-shortcut', id),
  launchLive: (id) => ipcRenderer.invoke('live:launch', id),
  verifyLiveProfile: (id) => ipcRenderer.invoke('live:verify-profile', id),
  installLive: (options) => ipcRenderer.invoke('live:install', options),
  retryLive: (id) => ipcRenderer.invoke('live:retry', id),
  cancelLive: (id) => ipcRenderer.invoke('live:cancel', id),
  pickDirectory: () => ipcRenderer.invoke('dialog:directory'),
  exportLogs: () => ipcRenderer.invoke('logs:export'),
  window: (action) => ipcRenderer.send('window:action', action),
  onState: (callback) => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on('state:changed', listener);
    return () => ipcRenderer.removeListener('state:changed', listener);
  },
});

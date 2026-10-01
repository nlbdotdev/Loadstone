export type Page = 'discover' | 'library' | 'downloads' | 'settings';
export type InstallStatus =
  | 'queued'
  | 'downloading'
  | 'extracting'
  | 'configuring'
  | 'paused'
  | 'complete'
  | 'cancelled';
export interface Setup {
  id: string;
  name: string;
  game: string;
  shortGame: string;
  description: string;
  longDescription: string;
  version: string;
  downloadGB: number;
  installGB: number;
  mods: number;
  author: string;
  tags: string[];
  art: string;
  color: string;
  requirements: string[];
  highlights: string[];
  updated: string;
}
export interface Job {
  id: string;
  setupId: string;
  progress: number;
  status: InstallStatus;
  previousStatus?: InstallStatus;
  destination: string;
  desktopShortcut: boolean;
  steamShortcut: boolean;
  createdAt: string;
}
export interface Installed {
  setupId: string;
  installedAt: string;
  destination: string;
  desktopShortcut: boolean;
  steamShortcut: boolean;
  lastPlayed?: string;
  sessions: number;
}
export interface Settings {
  dummyData: boolean;
  installRoot: string;
  reducedMotion: boolean;
  desktopShortcut: boolean;
  steamShortcut: boolean;
}
export interface AppState {
  schemaVersion: number;
  settings: Settings;
  jobs: Job[];
  installed: Installed[];
  logs: string[];
}
export interface Bridge {
  liveJobs(): Promise<LiveJob[]>;
  cleanupShortcuts(id: string): Promise<LiveJob[]>;
  removeLive(id: string): Promise<LiveJob[]>;
  steamAccounts(): Promise<{ id: string; label: string }[]>;
  steamShortcut(id: string, accountId: string): Promise<{ message: string }>;
  desktopShortcut(id: string): Promise<LiveJob[]>;
  launchLive(id: string): Promise<LiveJob[]>;
  verifyLiveProfile(id: string): Promise<string>;
  installLive(options: {
    id: string;
    gameFolder: string;
    destination: string;
  }): Promise<LiveJob[]>;
  retryLive(id: string): Promise<LiveJob[]>;
  cancelLive(id: string): Promise<LiveJob[]>;
  nexus(): Promise<NexusStatus>;
  connectNexus(key: string): Promise<NexusStatus>;
  verifyNexus(): Promise<NexusStatus>;
  disconnectNexus(): Promise<NexusStatus>;
  runtime(): Promise<RuntimeStatus>;
  installRuntime(): Promise<RuntimeStatus>;
  verifyRuntime(): Promise<RuntimeStatus>;
  cancelRuntime(): Promise<RuntimeStatus>;
  liveInstallRoot(): Promise<string>;
  liveCatalog(): Promise<Manifest[]>;
  importManifest(): Promise<Manifest[] | null>;
  discoverGames(): Promise<{ games: DiscoveredGame[]; warnings: string[] }>;
  preflight(options: {
    id: string;
    gameFolder: string;
    destination: string;
  }): Promise<Preflight>;
  getState(): Promise<AppState>;
  settings(patch: Partial<Settings>): Promise<AppState>;
  install(options: {
    setupId: string;
    destination: string;
    desktopShortcut: boolean;
    steamShortcut: boolean;
  }): Promise<AppState>;
  job(
    action: 'pause' | 'resume' | 'cancel' | 'retry' | 'clear',
    id: string,
  ): Promise<AppState>;
  library(
    action: 'play' | 'verify' | 'uninstall',
    setupId: string,
  ): Promise<AppState>;
  resetDemo(): Promise<AppState>;
  pickDirectory(): Promise<string | null>;
  exportLogs(): Promise<string | null>;
  window(action: 'minimize' | 'maximize' | 'close'): void;
  onState(callback: (state: AppState) => void): () => void;
}
export interface LiveJob {
  version: string;
  removalRecoveryPath?: string;
  shortcutCleanupError?: string | null;
  shortcutsCleaned?: boolean;
  steamShortcutError?: string | null;
  desktopShortcut?: string;
  shortcutError?: string | null;
  launch?: {
    phase: 'starting' | 'open' | 'closed' | 'error';
    message: string;
  } | null;
  id: string;
  setupId: string;
  name: string;
  destination: string;
  gameFolder: string;
  status:
    | 'preparing'
    | 'installing'
    | 'verifying'
    | 'installed'
    | 'failed'
    | 'cancelled'
    | 'interrupted'
    | 'removing'
    | 'removed'
    | 'removal-failed';
  logs: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
  installedAt?: string;
}
export interface NexusStatus {
  available: boolean;
  connected: boolean;
  name: string | null;
  premium: boolean | null;
  verifiedAt: string | null;
  error: string | null;
}
export interface RuntimeStatus {
  status: 'missing' | 'installing' | 'checking' | 'ready' | 'error';
  version: string;
  phase: string;
  downloadedBytes: number;
  totalBytes: number;
  error: string | null;
}
export interface Manifest {
  update?: {
    fromVersions: string[];
    saveCompatibility: 'compatible' | 'new-game-required' | 'unknown';
    notes: string;
  };
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  website: string;
  game: {
    id: 'fnv' | 'skyrimse' | 'fallout4';
    versions: string[];
    executableHashes: string[];
    requiredFiles: { path: string; sha256: string }[];
  };
  storage: { downloadBytes: number; installBytes: number };
  archive: { file: string; sha256: string; source: string };
  launch: { manager: 'mo2'; profile: string; executable: string };
  credits: { name: string; author: string; source: string; license: string }[];
}
export interface DiscoveredGame {
  id: Manifest['game']['id'];
  name: string;
  folder: string;
  source: 'steam';
  buildId: string | null;
}
export interface Preflight {
  id: string;
  checkedAt: string;
  ready: boolean;
  checks: { name: string; status: 'pass' | 'fail'; detail: string }[];
}
declare global {
  interface Window {
    loadstone: Bridge;
  }
}

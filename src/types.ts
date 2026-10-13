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
  onboardingComplete: boolean;
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
  nativeLibrary(): Promise<NativeLibraryState>;
  prepareNativeLibrary(): Promise<NativeLibraryPlan | null>;
  registerNativeLibrary(id: string): Promise<NativeLibraryState>;
  verifyNativeLibrary(id: string): Promise<NativeLibraryState>;
  cancelNativeVerification(): Promise<void>;
  launchNative(id: string): Promise<NativeLibraryEntry[]>;
  removeNative(id: string): Promise<NativeLibraryState>;
  cleanupNativeShortcuts(id: string): Promise<NativeLibraryState>;
  nativeDesktopShortcut(id: string): Promise<string>;
  nativeSteamShortcut(
    id: string,
    accountId: string,
  ): Promise<{ message: string }>;
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
  inspectNativePackage(): Promise<NativePackageSummary | null>;
  nativeBuilds(): Promise<NativeBuild[]>;
  nativeGuide(): Promise<NativeGuideState | null>;
  repairNativeSetup(id: string): Promise<NativeGuideState | null>;
  importNativeSetup(resumeId?: string): Promise<NativeGuideState | null>;
  selectNativeInput(
    id: string,
    kind:
      | 'game'
      | 'prerequisite'
      | 'archive'
      | 'download'
      | 'parent'
      | 'configuration',
    key?: string,
    token?: string,
  ): Promise<NativeGuideState>;
  reviewNativeSetup(id: string): Promise<NativeGuideState>;
  installNativeSetup(id: string, planId: string): Promise<NativeBuild[]>;
  admitNativeBuild(id: string): Promise<boolean>;
  prepareNativeBuild(): Promise<NativeBuildPlan | null>;
  resumeNativeBuild(id: string): Promise<NativeBuildPlan | null>;
  startNativeBuild(id: string): Promise<NativeBuild[]>;
  cancelNativeBuild(id: string): Promise<NativeBuild[]>;
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
export interface NativeLibraryEntry {
  status:
    | 'installed'
    | 'removing'
    | 'removal-failed'
    | 'removed'
    | 'repairing'
    | 'repair-failed';
  repair: {
    directory: string;
    startedAt: string;
    completedAt: string | null;
    preserved: number;
  } | null;
  recoveryRoot: string | null;
  maintenanceError: string | null;
  shortcutsCleaned: boolean;
  shortcutError: string | null;
  id: string;
  name: string;
  version: string;
  root: string;
  profile: string;
  fileCount: number;
  verifiedAt: string;
  saveStatus: string;
  saveNotes: string;
  launch: { phase: string; message: string } | null;
}
export interface NativeLibraryState {
  entries: NativeLibraryEntry[];
  busy: boolean;
  progress: {
    completed: number;
    total: number;
    phase?:
      | 'verification'
      | 'inventory'
      | 'removal-review'
      | 'removal'
      | 'repair-review'
      | 'repair-downloads'
      | 'repair';
  } | null;
  error: string | null;
}
export interface NativeLibraryPlan {
  id: string;
  name: string;
  version: string;
  root: string;
  profile: string;
  fileCount: number;
  saveCompatibility: { status: string; notes: string };
}
export interface NativePackageSummary {
  generatedConfigurations: number;
  name: string;
  version: string;
  author: string;
  game: { id: 'fnv' | 'skyrimse' | 'fallout4'; variant: 'base' | 'ttw' };
  profile: string;
  requiredGames: string[];
  prerequisites: NativePrerequisiteSummary[];
  prerequisiteSources: number;
  outputs: number;
  installBytes: number;
  downloadSources: number;
  gameSources: number;
  payloadSources: number;
  recipeSha256: string;
  saveCompatibility: {
    status: 'unknown' | 'new-save-required' | 'compatible';
    notes: string;
  };
}
export interface LiveJob {
  outputVerification?: {
    files: number;
    sizeChecked: number;
    presenceOnly: number;
    temporaryInputs: number;
    checkedAt: string;
  };
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
  launch: {
    manager: 'mo2';
    profile: string;
    executable: string;
    gameRoot?: string;
  };
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

export interface NativeBuildPlan {
  repair?: {
    reused: number;
    missing: number;
    conflicts: number;
    preserved: number;
    preservedPaths: string[];
    retained: number;
    recoveryRoot: string;
    restoreConfiguration: boolean;
  };
  resume?: {
    jobId: string;
    reused: number;
    conflicts: number;
    missing: number;
    retained: number;
    writeBytes: number;
    recoveryRoot: string;
  };
  generatedConfigurations: number;
  id: string;
  name: string;
  version: string;
  recipeSha256: string;
  destination: string;
  outputs: number;
  installBytes: number;
  requiredGames: string[];
  prerequisites: NativePrerequisiteSummary[];
  archiveCount: number;
  downloadCount: number;
  downloadBytes: number;
  downloadHosts: string[];
  downloadCache: string | null;
  archiveTool: string | null;
}
export interface NativeGuideState {
  repair: {
    entryId: string;
    destination: string;
    recipeSha256: string;
    restoreConfiguration: boolean;
  } | null;
  id: string;
  recipeSha256: string;
  name: string;
  version: string;
  author: string;
  description: string;
  game: { id: 'fnv' | 'skyrimse' | 'fallout4'; variant: 'base' | 'ttw' };
  saveCompatibility: {
    status: 'compatible' | 'unknown' | 'new-save-required';
    notes: string;
  };
  outputs: number;
  installBytes: number;
  games: {
    id: string;
    store: string;
    folder: string | null;
    detected: { token: string; folder: string }[];
  }[];
  prerequisites: {
    id: string;
    name: string;
    version: string;
    files: number;
    instructions: string;
    folder: string | null;
  }[];
  archives: {
    id: string;
    type: 'nexus-archive' | 'https-archive';
    bytes: number;
    sha256: string;
    source: string;
    credit: string;
    file: string | null;
  }[];
  parent: string | null;
  resumeId: string | null;
  ready: boolean;
  plan: NativeBuildPlan | null;
}
export interface NativeBuild {
  id: string;
  name: string;
  version: string;
  recipeSha256: string;
  destination: string;
  status:
    | 'queued'
    | 'building'
    | 'stopping'
    | 'verified'
    | 'failed'
    | 'cancelled'
    | 'interrupted';
  completed: number;
  total: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  activity?: {
    phase:
      | 'downloads'
      | 'inputs'
      | 'archives'
      | 'outputs'
      | 'verification'
      | 'recovery';
    completed: number;
    total: number;
    bytes: number;
    totalBytes: number;
  };
}
export interface NativePrerequisiteSummary {
  id: string;
  name: string;
  version: string;
  files: number;
}

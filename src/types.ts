export type Page = 'discover' | 'library' | 'downloads' | 'settings';
export type InstallStatus = 'queued' | 'downloading' | 'extracting' | 'configuring' | 'paused' | 'complete' | 'cancelled';
export interface Setup {
  id: string; name: string; game: string; shortGame: string; description: string;
  longDescription: string; version: string; downloadGB: number; installGB: number;
  mods: number; author: string; tags: string[]; art: string; color: string;
  requirements: string[]; highlights: string[]; updated: string;
}
export interface Job { id: string; setupId: string; progress: number; status: InstallStatus; previousStatus?: InstallStatus; destination: string; desktopShortcut: boolean; steamShortcut: boolean; createdAt: string; }
export interface Installed { setupId: string; installedAt: string; destination: string; desktopShortcut: boolean; steamShortcut: boolean; lastPlayed?: string; sessions: number; }
export interface Settings { dummyData: boolean; installRoot: string; reducedMotion: boolean; desktopShortcut: boolean; steamShortcut: boolean; }
export interface AppState { schemaVersion: number; settings: Settings; jobs: Job[]; installed: Installed[]; logs: string[]; }
export interface Bridge {
  getState(): Promise<AppState>;
  settings(patch: Partial<Settings>): Promise<AppState>;
  install(options: { setupId: string; destination: string; desktopShortcut: boolean; steamShortcut: boolean }): Promise<AppState>;
  job(action: 'pause' | 'resume' | 'cancel' | 'retry' | 'clear', id: string): Promise<AppState>;
  library(action: 'play' | 'verify' | 'uninstall', setupId: string): Promise<AppState>;
  resetDemo(): Promise<AppState>;
  pickDirectory(): Promise<string | null>;
  exportLogs(): Promise<string | null>;
  window(action: 'minimize' | 'maximize' | 'close'): void;
  onState(callback: (state: AppState) => void): () => void;
}
declare global { interface Window { loadstone: Bridge; } }

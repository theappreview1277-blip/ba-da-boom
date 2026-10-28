// Shared between main, preload and renderer. Types and channel names only.

export const CHANNELS = {
  importSample: 'bdb:import-sample',
  openProject: 'bdb:open-project',
  saveProject: 'bdb:save-project',
  autosaveWrite: 'bdb:autosave-write',
  autosaveRecover: 'bdb:autosave-recover',
  saveWav: 'bdb:save-wav',
  appInfo: 'bdb:app-info',
  showInFolder: 'bdb:show-in-folder',
  beforeClose: 'bdb:before-close',
  closeReady: 'bdb:close-ready',
  closePending: 'bdb:close-pending',
} as const;

export interface OpenResult {
  path: string | null;
  text: string;
  /** User sample files that could not be found. */
  missing: string[];
}

export interface SaveRequest {
  path: string | null;
  saveAs: boolean;
  name: string;
  text: string;
}

export interface SaveResult {
  path: string;
  /** User sample files that could not be copied into the project folder. */
  notCollected: string[];
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  platform: string;
  packaged: boolean;
  notices: string;
}

/** The API exposed to the renderer as window.bdb. */
export interface DesktopApi {
  importSample(name: string, bytes: Uint8Array): Promise<{ file: string }>;
  openProject(path?: string): Promise<OpenResult | null>;
  saveProject(req: SaveRequest): Promise<SaveResult | null>;
  autosaveWrite(text: string): Promise<void>;
  autosaveRecover(): Promise<OpenResult | null>;
  saveWav(name: string, bytes: Uint8Array): Promise<string | null>;
  appInfo(): Promise<AppInfo>;
  showInFolder(path: string): Promise<void>;
  onBeforeClose(cb: () => void): void;
  closeReady(): Promise<void>;
  /** The renderer is asking the user about unsaved changes; don't force-close. */
  closePending(): Promise<void>;
}

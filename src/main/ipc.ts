// Shared between main, preload and renderer. Types and channel names only.

export const CHANNELS = {
  importSample: 'bdb:import-sample',
  openProject: 'bdb:open-project',
  saveProject: 'bdb:save-project',
  autosaveWrite: 'bdb:autosave-write',
  autosaveRecover: 'bdb:autosave-recover',
  saveWav: 'bdb:save-wav',
  saveMidi: 'bdb:save-midi',
  saveStems: 'bdb:save-stems',
  appInfo: 'bdb:app-info',
  showInFolder: 'bdb:show-in-folder',
  kitList: 'bdb:kit-list',
  kitDownload: 'bdb:kit-download',
  kitProgress: 'bdb:kit-progress',
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

export interface KitSample {
  sound: string;
  index: number;
  /** Pool file name (content hash). */
  file: string;
}

export interface KitResult {
  kit: string;
  /** Sound name -> number of variants in the kit. */
  sounds: Record<string, number>;
  samples: KitSample[];
  /** Files that could not be downloaded. */
  failed: number;
  /** Files fetched from the internet (0 when the kit is bundled or already in the pool). */
  downloaded: number;
}

export interface KitProgress {
  kit: string;
  done: number;
  total: number;
}

/** The API exposed to the renderer as window.bdb. */
export interface DesktopApi {
  importSample(name: string, bytes: Uint8Array): Promise<{ file: string }>;
  openProject(path?: string): Promise<OpenResult | null>;
  saveProject(req: SaveRequest): Promise<SaveResult | null>;
  autosaveWrite(text: string): Promise<void>;
  autosaveRecover(): Promise<OpenResult | null>;
  saveWav(name: string, bytes: Uint8Array): Promise<string | null>;
  saveMidi(name: string, bytes: Uint8Array): Promise<string | null>;
  /** Asks for a folder, writes the files into a new "<name> stems" folder there and returns its path. */
  saveStems(name: string, files: { name: string; bytes: Uint8Array }[]): Promise<string | null>;
  appInfo(): Promise<AppInfo>;
  showInFolder(path: string): Promise<void>;
  /** Strudel's drum machine kits: name -> sound -> number of variants. */
  kitList(): Promise<Record<string, Record<string, number>>>;
  /** Puts a kit into the sample pool: from the bundled kits, the pool itself, or a download. */
  kitDownload(name: string): Promise<KitResult>;
  onKitProgress(cb: (p: KitProgress) => void): void;
  onBeforeClose(cb: () => void): void;
  closeReady(): Promise<void>;
  /** The renderer is asking the user about unsaved changes; don't force-close. */
  closePending(): Promise<void>;
}

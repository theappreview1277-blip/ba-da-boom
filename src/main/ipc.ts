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
  settingsGet: 'bdb:settings-get',
  settingsSet: 'bdb:settings-set',
  folderAdd: 'bdb:folder-add',
  folderRemove: 'bdb:folder-remove',
  folderList: 'bdb:folder-list',
  folderRead: 'bdb:folder-read',
  beforeClose: 'bdb:before-close',
  closeReady: 'bdb:close-ready',
  closePending: 'bdb:close-pending',
  launchFile: 'bdb:launch-file',
  openFile: 'bdb:open-file',
  log: 'bdb:log',
  showLog: 'bdb:show-log',
  updateState: 'bdb:update-state',
  updateGet: 'bdb:update-get',
  updateCheck: 'bdb:update-check',
  updateDownload: 'bdb:update-download',
  updateInstall: 'bdb:update-install',
} as const;

export const TOOL_TABS = ['library', 'beats', 'generate', 'pads', 'mixer'] as const;
export type ToolTab = (typeof TOOL_TABS)[number];
export const STEP_LANES = ['velocity', 'probability', 'micro'] as const;
export type StepLane = (typeof STEP_LANES)[number];
/** How MIDI notes pick a track: the General MIDI drum map, or pads in order from note 36 (C1). */
export const MIDI_MAPS = ['gm', 'pads36'] as const;
export type MidiMap = (typeof MIDI_MAPS)[number];

/** Where the sound goes and what plays it. */
export interface SoundSettings {
  /** The sound card picked in Settings; unset means the system default. The name finds it again if its id changes. */
  output?: { id: string; label: string };
  /** The MIDI input to listen to (its name); unset means every connected input. */
  midiInput?: string;
  midiMap?: MidiMap;
  /** Letter keys play the pads (Z X C V … and A S D F …). */
  padKeys?: boolean;
  /** Recorded hits go to the nearest step (true) or keep their exact timing (false). */
  quantise?: boolean;
}

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
  /** Where the error log is written. */
  logFile: string;
  notices: string;
}

/**
 * Where the app is with updates. "off" when updates can't work here (not the installed app).
 * "none" after a check found nothing newer; "error" after a check or download failed.
 */
export type UpdateState =
  | { state: 'off' }
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'none' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

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

/** Remembered between sessions, in settings.json. */
export interface Settings {
  /** Folders added to the sample browser (absolute paths). */
  folders: string[];
  /** Starred samples: "factory:<key>", "pool:<file>" or "file:<folder>|<relative path>". */
  favourites: string[];
  /** Side panel widths in CSS pixels; unset means the default for the window size. */
  layout: {
    left?: number;
    right?: number;
    /** The tab open in the tool panel under the grid, and whether the panel is open. */
    tool?: ToolTab;
    toolsOpen?: boolean;
    /** What the step lane under the grid edits. */
    lane?: StepLane;
  };
  sound: SoundSettings;
  /** The welcome screen has been seen, so it is not shown at start-up any more. */
  welcomed?: boolean;
}

export interface FolderListing {
  path: string;
  /** Sound files, relative to the folder with / separators. */
  files: string[];
  /** More files than the browser lists. */
  truncated: boolean;
  /** False when the folder can't be opened (moved, deleted or a drive not connected). */
  readable: boolean;
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
  settingsGet(): Promise<Settings>;
  /** Changes favourites and/or layout; returns the stored settings. */
  settingsSet(patch: Partial<Pick<Settings, 'favourites' | 'layout' | 'sound' | 'welcomed'>>): Promise<Settings>;
  /** Asks for a folder and adds it to the browser. Null if cancelled. */
  folderAdd(): Promise<FolderListing | null>;
  folderRemove(path: string): Promise<void>;
  /** Scans every added folder again. */
  folderList(): Promise<FolderListing[]>;
  /** Copies a WAV from an added folder into the sample pool; other formats come back as bytes to convert. */
  folderRead(folder: string, file: string): Promise<{ file: string } | { bytes: Uint8Array }>;
  onBeforeClose(cb: () => void): void;
  closeReady(): Promise<void>;
  /** The renderer is asking the user about unsaved changes; don't force-close. */
  closePending(): Promise<void>;
  /** The project file Windows asked the app to open at start-up (once), or null. */
  launchFile(): Promise<string | null>;
  /** A project file double-clicked while the app is already open. */
  onOpenFile(cb: (path: string) => void): void;
  /** Write a line to the error log. */
  log(level: 'info' | 'warn' | 'error', message: string): Promise<void>;
  /** Show the error log file in Explorer. */
  showLog(): Promise<void>;
  /** Update news from the main process (checks, downloads). */
  onUpdateState(cb: (s: UpdateState) => void): void;
  updateGet(): Promise<UpdateState>;
  /** Looks for a newer version on GitHub. */
  updateCheck(): Promise<UpdateState>;
  /** Downloads the version found by the last check. */
  updateDownload(): Promise<void>;
  /** Closes the app, installs the downloaded version and starts it again. */
  updateInstall(): Promise<void>;
}

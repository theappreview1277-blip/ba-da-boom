// The screen inside the VST3 / CLAP plugin. The plugin's web view (JUCE) provides
// window.__JUCE__.backend; requests go out on the "bdb" event and answers come back on
// "bdbReply". See plugin/src/Editor.h for the other side.

import type { DesktopApi, Settings } from '../main/ipc';

interface JuceBackend {
  emitEvent(id: string, payload: unknown): void;
  addEventListener(id: string, fn: (payload: any) => void): unknown;
}

declare global {
  interface Window {
    __JUCE__?: { backend?: JuceBackend };
  }
}

const backend = (): JuceBackend | undefined => window.__JUCE__?.backend;
export const inPlugin = typeof window !== 'undefined' && !!backend();

/** What the plugin reports 30 times a second. */
export interface PluginState {
  playing: boolean;
  /** Host position in cycles (bars) from bar 1, or from the song's start. */
  cycle: number;
  songEntry: number;
  /** Index of the pattern being heard, or -1. */
  pattern: number;
  bpm: number;
  left: number;
  right: number;
  tracks: number[];
}

let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
const stateListeners = new Set<(s: PluginState) => void>();
const projectListeners = new Set<() => void>();
let lastState: PluginState = { playing: false, cycle: 0, songEntry: -1, pattern: -1, bpm: 0, left: 0, right: 0, tracks: [] };

if (inPlugin) {
  const b = backend()!;
  b.addEventListener('bdbReply', (r: { id: number; ok: boolean; result64?: string; error?: string }) => {
    const p = pending.get(r.id);
    if (!p) return;
    pending.delete(r.id);
    if (r.ok) p.resolve(r.result64 ? fromReply(r.result64) : null);
    else p.reject(new Error(r.error ?? 'The plugin could not do that.'));
  });
  b.addEventListener('bdbState', (s: PluginState) => {
    lastState = s;
    for (const fn of stateListeners) fn(s);
  });
  b.addEventListener('bdbProject', () => projectListeners.forEach((fn) => fn()));
}

/** Ask the plugin for something. File dialogs answer when the user is done with them. */
export function call<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const b = backend();
  if (!b) return Promise.reject(new Error('Not running inside the plugin.'));
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    b.emitEvent('bdb', { id, name, args });
  });
}

// The screen's first project must not replace the one the host saved in the plugin, so
// nothing is sent until that one has been loaded (or found to be empty).
let sendAllowed = false;
const allowListeners = new Set<(loaded: boolean) => void>();
export const canSend = () => sendAllowed;
/** `loaded`: a saved project was loaded (and will arrive as an edit); false: the plugin was empty. */
export function allowSending(loaded: boolean) {
  sendAllowed = true;
  allowListeners.forEach((fn) => fn(loaded));
}
export function onSendingAllowed(fn: (loaded: boolean) => void) {
  allowListeners.add(fn);
}

export const pluginState = () => lastState;
export function onPluginState(fn: (s: PluginState) => void) {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}
/** The host loaded another of its projects into the plugin. */
export function onProjectReplaced(fn: () => void) {
  projectListeners.add(fn);
  return () => projectListeners.delete(fn);
}

/** A reply's result: JSON, sent as base64 (see Editor::reply). */
export function fromReply(b64: string): unknown {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes)) ?? null;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const DEFAULT_SETTINGS: Settings = { folders: [], favourites: [], layout: {}, sound: {}, welcomed: true };
let settings: Settings | null = null;

const notInPlugin = (what: string) => async (): Promise<never> => {
  throw new Error(`${what} is in the Ba-da-boom app, not in the plugin.`);
};

/** The desktop services, as the plugin provides them. */
export const pluginApi: DesktopApi = {
  async importSample(name, bytes) {
    return call<{ file: string }>('importSample', { name, data: toBase64(bytes) });
  },
  async openProject() {
    return call('openProject');
  },
  async saveProject(req) {
    return call('saveProject', { ...req });
  },
  // The plugin keeps the project in the host's project; it is sent with every change (PluginEngine).
  async autosaveWrite() {},
  async autosaveRecover() {
    return null;
  },
  async saveWav(name, bytes) {
    return call('saveFile', { name, ext: 'wav', data: toBase64(bytes) });
  },
  async saveMidi(name, bytes) {
    return call('saveFile', { name, ext: 'mid', data: toBase64(bytes) });
  },
  async saveStems(name, files) {
    return call('saveStems', { name, files: files.map((f) => ({ name: f.name, data: toBase64(f.bytes) })) });
  },
  async appInfo() {
    const s = await call<{ version: string; pluginFormat: string }>('getState');
    return { version: s.version, electron: '-', chrome: navigator.userAgent, platform: `${s.pluginFormat} plugin`, packaged: true, logFile: '', notices: '' };
  },
  async showInFolder(path) {
    await call('showInFolder', { path });
  },
  async kitList() {
    return {};
  },
  kitDownload: notInPlugin('Downloading kits'),
  onKitProgress() {},
  async settingsGet() {
    if (!settings) {
      const s = await call<{ settings: Settings | null }>('getState');
      settings = { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) };
    }
    return settings;
  },
  async settingsSet(patch) {
    const s = await pluginApi.settingsGet();
    settings = { ...s, ...patch, layout: { ...s.layout, ...patch.layout }, sound: { ...s.sound, ...patch.sound } };
    await call('settingsSet', { settings });
    return settings;
  },
  folderAdd: notInPlugin('Sample folders'),
  async folderRemove() {},
  async folderList() {
    return [];
  },
  folderRead: notInPlugin('Sample folders'),
  onBeforeClose() {},
  async closeReady() {},
  async closePending() {},
  async launchFile() {
    return null;
  },
  onOpenFile() {},
  async log(level, message) {
    await call('log', { level, message }).catch(() => {});
  },
  async showLog() {},
  onUpdateState() {},
  async updateGet() {
    return { state: 'off' };
  },
  async updateCheck() {
    return { state: 'off' };
  },
  async updateDownload() {},
  async updateInstall() {},
};

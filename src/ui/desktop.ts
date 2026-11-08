// Access to desktop services. Inside Electron this is the preload bridge.
// In a plain browser (used for automated tests of the renderer) a small
// in-memory stand-in is used so the UI and audio engine can be exercised.

import type { DesktopApi, OpenResult, Settings } from '../main/ipc';
import type { SampleRef } from '../model/types';

declare global {
  interface Window {
    bdb?: DesktopApi;
  }
}

const blobUrls = new Map<string, string>();
let browserSettings: Settings = { folders: [], favourites: [], layout: {}, sound: {} };
const memoryFiles = new Map<string, string>();

const browserApi: DesktopApi = {
  async importSample(_name, bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
    const file =
      Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('') + '.wav';
    blobUrls.set(file, URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/wav' })));
    return { file };
  },
  async openProject(path) {
    const text = path ? memoryFiles.get(path) : undefined;
    return text ? ({ path: path!, text, missing: [] } satisfies OpenResult) : null;
  },
  async saveProject(req) {
    const path = req.path ?? `memory://${req.name}.badaboom`;
    memoryFiles.set(path, req.text);
    return { path, notCollected: [] };
  },
  async autosaveWrite(text) {
    memoryFiles.set('autosave', text);
  },
  async autosaveRecover() {
    return null;
  },
  async saveWav(name, bytes) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/wav' }));
    a.download = `${name}.wav`;
    a.click();
    (window as any).__lastExport = bytes;
    return `${name}.wav`;
  },
  async saveMidi(name, bytes) {
    (window as any).__lastMidi = bytes;
    return `${name}.mid`;
  },
  async saveStems(name, files) {
    (window as any).__lastStems = files;
    return `${name} stems`;
  },
  async appInfo() {
    return { version: 'browser', electron: '-', chrome: navigator.userAgent, platform: 'browser', packaged: false, logFile: '', notices: '' };
  },
  async showInFolder() {},
  async kitList() {
    return {};
  },
  async kitDownload() {
    throw new Error('Downloading kits needs the desktop app.');
  },
  onKitProgress() {},
  async settingsGet() {
    return browserSettings;
  },
  async settingsSet(patch) {
    browserSettings = { ...browserSettings, ...patch, layout: { ...browserSettings.layout, ...patch.layout }, sound: { ...browserSettings.sound, ...patch.sound } };
    return browserSettings;
  },
  async folderAdd() {
    return null;
  },
  async folderRemove() {},
  async folderList() {
    return [];
  },
  async folderRead() {
    throw new Error('Sample folders need the desktop app.');
  },
  onBeforeClose() {},
  async closeReady() {},
  async closePending() {},
  async launchFile() {
    return null;
  },
  onOpenFile() {},
  async log(level, message) {
    ((window as any).__log ??= []).push(`${level}: ${message}`);
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

export const desktop: DesktopApi = window.bdb ?? browserApi;
export const inElectron = !!window.bdb;

export function sampleUrl(ref: SampleRef): string {
  if (ref.source === 'factory') return new URL(`samples/${ref.file}`, document.baseURI).toString();
  if (inElectron) return `bdb://app/pool/${encodeURIComponent(ref.file)}`;
  return blobUrls.get(ref.file) ?? `missing://${ref.file}`;
}

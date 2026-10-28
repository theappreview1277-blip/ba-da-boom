// The only bridge between the sandboxed renderer and the main process.
// Exposes a fixed set of functions; no Node APIs or raw ipcRenderer.
import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type DesktopApi } from '../main/ipc';

const api: DesktopApi = {
  importSample: (name, bytes) => ipcRenderer.invoke(CHANNELS.importSample, name, bytes),
  openProject: (path) => ipcRenderer.invoke(CHANNELS.openProject, path),
  saveProject: (req) => ipcRenderer.invoke(CHANNELS.saveProject, req),
  autosaveWrite: (text) => ipcRenderer.invoke(CHANNELS.autosaveWrite, text),
  autosaveRecover: () => ipcRenderer.invoke(CHANNELS.autosaveRecover),
  saveWav: (name, bytes) => ipcRenderer.invoke(CHANNELS.saveWav, name, bytes),
  saveMidi: (name, bytes) => ipcRenderer.invoke(CHANNELS.saveMidi, name, bytes),
  saveStems: (name, files) => ipcRenderer.invoke(CHANNELS.saveStems, name, files),
  appInfo: () => ipcRenderer.invoke(CHANNELS.appInfo),
  showInFolder: (path) => ipcRenderer.invoke(CHANNELS.showInFolder, path),
  onBeforeClose: (cb) => {
    ipcRenderer.on(CHANNELS.beforeClose, () => cb());
  },
  closeReady: () => ipcRenderer.invoke(CHANNELS.closeReady),
  closePending: () => ipcRenderer.invoke(CHANNELS.closePending),
};

contextBridge.exposeInMainWorld('bdb', api);

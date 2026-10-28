// Electron main process: window, the bdb:// protocol, and desktop services
// (files, dialogs, autosave). The renderer is sandboxed and has no Node access;
// everything it needs from the OS goes through the narrow IPC API in preload.ts.

import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHANNELS, type OpenResult, type SaveRequest, type SaveResult } from './ipc';

const isDev = process.env.BDB_DEV === '1';
const RENDERER_DIR = join(__dirname, '..', 'dist');
const userDir = () => app.getPath('userData');
const POOL_DIR = () => join(userDir(), 'sample-pool');
const AUTOSAVE_FILE = () => join(userDir(), 'autosave', 'autosave.badaboom');
const SESSION_LOCK = () => join(userDir(), 'autosave', 'session.lock');
const PROJECT_EXT = 'badaboom';
const MAX_SAMPLE_BYTES = 200 * 1024 * 1024;

protocol.registerSchemesAsPrivileged([
  { scheme: 'bdb', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

/** File names coming from the renderer or a project file must be plain names. */
function safeName(name: string): string | null {
  if (!name || name !== basename(name) || name.includes('..') || /[\\/:*?"<>|]/.test(name)) return null;
  return name;
}

const CSP = [
  "default-src 'self'",
  // Superdough ships its AudioWorklet processors as data: URLs.
  "script-src 'self' data:",
  "worker-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' bdb: blob:",
  "connect-src 'self' bdb:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.wav': 'audio/wav',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain',
  '.woff2': 'font/woff2',
};

async function serveFile(path: string): Promise<Response> {
  try {
    const res = await net.fetch(pathToFileURL(path).toString());
    if (!res.ok) return new Response('not found', { status: 404 });
    const headers = new Headers({ 'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream' });
    if (extname(path) === '.html') headers.set('Content-Security-Policy', CSP);
    return new Response(res.body, { status: 200, headers });
  } catch {
    return new Response('not found', { status: 404 });
  }
}

function registerProtocol() {
  // Everything is served from one origin, bdb://app, so the renderer needs no CORS:
  //   bdb://app/pool/<file>   imported samples (content-addressed copies in userData)
  //   bdb://app/<path>        the renderer bundle, including factory samples in samples/
  protocol.handle('bdb', (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('not found', { status: 404 });
    let parts: string[];
    try {
      parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      return new Response('bad path', { status: 400 });
    }
    if (parts.some((p) => !safeName(p))) return new Response('bad path', { status: 400 });
    if (parts[0] === 'pool') {
      if (parts.length !== 2) return new Response('bad path', { status: 400 });
      return serveFile(join(POOL_DIR(), parts[1]));
    }
    return serveFile(join(RENDERER_DIR, ...(parts.length ? parts : ['index.html'])));
  });
}

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#121316',
    title: 'Ba-da-boom',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      // The scheduler runs on timers; throttling them in the background would cause dropouts.
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win?.show());
  win.loadURL(isDev ? 'http://localhost:5173' : 'bdb://app/index.html');

  // No navigation or new windows: external links open in the system browser.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && (isDev || process.env.BDB_DEVTOOLS === '1')) {
      win?.webContents.toggleDevTools();
    }
  });

  // Closing asks the renderer first, so it can flush autosave and offer to save
  // unsaved work. If the renderer does not answer (hung or crashed), close anyway.
  let allowClose = false;
  let fallback: NodeJS.Timeout | undefined;
  win.on('close', (e) => {
    if (allowClose || !win || win.webContents.isCrashed()) return;
    e.preventDefault();
    win.webContents.send(CHANNELS.beforeClose);
    clearTimeout(fallback);
    fallback = setTimeout(() => {
      allowClose = true;
      win?.close();
    }, 3000);
  });
  ipcMain.removeHandler(CHANNELS.closePending);
  ipcMain.handle(CHANNELS.closePending, () => clearTimeout(fallback));
  ipcMain.removeHandler(CHANNELS.closeReady);
  ipcMain.handle(CHANNELS.closeReady, () => {
    clearTimeout(fallback);
    allowClose = true;
    win?.close();
  });
}

async function atomicWrite(path: string, data: string | Uint8Array) {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, path);
}

function isWav(buf: Buffer) {
  return buf.length > 44 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE';
}

async function poolHas(file: string) {
  return existsSync(join(POOL_DIR(), file));
}

/** Copy a WAV into the pool under a content hash name. */
async function addToPool(buf: Buffer): Promise<string> {
  const file = createHash('sha256').update(buf).digest('hex').slice(0, 32) + '.wav';
  if (!(await poolHas(file))) await atomicWrite(join(POOL_DIR(), file), buf);
  return file;
}

function registerIpc() {
  ipcMain.handle(CHANNELS.importSample, async (_e, name: unknown, bytes: unknown) => {
    if (typeof name !== 'string' || !(bytes instanceof Uint8Array)) throw new Error('bad request');
    if (bytes.byteLength > MAX_SAMPLE_BYTES) throw new Error('Sample is larger than 200 MB.');
    const buf = Buffer.from(bytes);
    if (!isWav(buf)) throw new Error(`${name} is not a WAV file.`);
    return { file: await addToPool(buf) };
  });

  ipcMain.handle(CHANNELS.openProject, async (_e, givenPath?: unknown): Promise<OpenResult | null> => {
    let path = typeof givenPath === 'string' ? givenPath : null;
    if (!path) {
      const r = await dialog.showOpenDialog(win!, {
        title: 'Open project',
        filters: [{ name: 'Ba-da-boom project', extensions: [PROJECT_EXT] }],
        properties: ['openFile'],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      path = r.filePaths[0];
    }
    const text = await fs.readFile(path, 'utf8');
    // Bring the project's collected samples into the pool so they can be played.
    const samplesDir = join(dirname(path), 'samples');
    const missing: string[] = [];
    const files = extractUserSampleFiles(text);
    for (const f of files) {
      if (await poolHas(f)) continue;
      const src = join(samplesDir, f);
      try {
        const buf = await fs.readFile(src);
        if (!isWav(buf)) throw new Error('not wav');
        await atomicWrite(join(POOL_DIR(), f), buf);
      } catch {
        missing.push(f);
      }
    }
    return { path, text, missing };
  });

  ipcMain.handle(CHANNELS.saveProject, async (_e, req: SaveRequest): Promise<SaveResult | null> => {
    let path = typeof req?.path === 'string' ? req.path : null;
    if (!path || req.saveAs) {
      const r = await dialog.showSaveDialog(win!, {
        title: 'Save project',
        defaultPath: join(app.getPath('documents'), `${req?.name || 'Untitled'}`),
        filters: [{ name: 'Ba-da-boom project', extensions: [PROJECT_EXT] }],
      });
      if (r.canceled || !r.filePath) return null;
      // Each project gets its own folder: <chosen>/<name>.badaboom + samples/
      const base = basename(r.filePath, `.${PROJECT_EXT}`);
      const parent = dirname(r.filePath);
      const folder = basename(parent) === base ? parent : join(parent, base);
      path = join(folder, `${base}.${PROJECT_EXT}`);
    }
    if (typeof req.text !== 'string') throw new Error('bad request');
    // Collect user samples next to the project so the folder is portable.
    const samplesDir = join(dirname(path), 'samples');
    const notCollected: string[] = [];
    for (const f of extractUserSampleFiles(req.text)) {
      const dest = join(samplesDir, f);
      if (existsSync(dest)) continue;
      try {
        await fs.mkdir(samplesDir, { recursive: true });
        await fs.copyFile(join(POOL_DIR(), f), dest);
      } catch {
        notCollected.push(f);
      }
    }
    await atomicWrite(path, req.text);
    return { path, notCollected };
  });

  ipcMain.handle(CHANNELS.autosaveWrite, async (_e, text: unknown) => {
    if (typeof text !== 'string') return;
    await atomicWrite(AUTOSAVE_FILE(), text);
  });

  ipcMain.handle(CHANNELS.autosaveRecover, async () => {
    // A session lock left over from the previous run means it did not close cleanly.
    const crashed = existsSync(SESSION_LOCK());
    await atomicWrite(SESSION_LOCK(), String(Date.now()));
    if (!crashed || !existsSync(AUTOSAVE_FILE())) return null;
    const text = await fs.readFile(AUTOSAVE_FILE(), 'utf8');
    const missing: string[] = [];
    for (const f of extractUserSampleFiles(text)) if (!(await poolHas(f))) missing.push(f);
    return { path: null, text, missing } satisfies OpenResult;
  });

  ipcMain.handle(CHANNELS.saveWav, async (_e, name: unknown, bytes: unknown) => {
    if (typeof name !== 'string' || !(bytes instanceof Uint8Array)) throw new Error('bad request');
    const r = await dialog.showSaveDialog(win!, {
      title: 'Export WAV',
      defaultPath: join(app.getPath('music'), `${safeName(name) ?? 'export'}.wav`),
      filters: [{ name: 'WAV audio', extensions: ['wav'] }],
    });
    if (r.canceled || !r.filePath) return null;
    await atomicWrite(r.filePath, bytes);
    return r.filePath;
  });

  ipcMain.handle(CHANNELS.appInfo, async () => {
    let notices = '';
    try {
      notices = await fs.readFile(join(RENDERER_DIR, 'NOTICES.txt'), 'utf8');
    } catch {
      notices = 'Notices file missing from this build.';
    }
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      platform: `${process.platform} ${process.arch}`,
      packaged: app.isPackaged,
      notices,
    };
  });

  ipcMain.handle(CHANNELS.showInFolder, (_e, p: unknown) => {
    if (typeof p === 'string' && existsSync(p)) shell.showItemInFolder(p);
  });
}

/** User sample file names referenced by a project file, validated. */
function extractUserSampleFiles(text: string): string[] {
  try {
    const p = JSON.parse(text);
    const out = new Set<string>();
    for (const ref of Object.values<any>(p?.samples ?? {})) {
      if (ref?.source === 'user' && typeof ref.file === 'string' && safeName(ref.file)) out.add(ref.file);
    }
    return [...out];
  } catch {
    return [];
  }
}

// One instance only: a second launch focuses the first window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    // Nothing in this app needs camera, microphone, notifications etc.
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    registerProtocol();
    registerIpc();
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    // Clean exit: remove the lock so the next start does not offer recovery.
    try {
      require('node:fs').rmSync(SESSION_LOCK(), { force: true });
    } catch {
      /* ignore */
    }
  });
}

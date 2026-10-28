// Shared helpers for the end-to-end tests.
//
// Every test launches the real Electron app: the installed Ba-da-boom.exe when
// ELECTRON_EXE is set, otherwise the development build (`npx electron .`).
// Each launch uses its own temporary profile, so tests never touch the user's
// autosave or samples and still run while the user has the app open.

import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');

export const usingInstalledApp = () => !!process.env.ELECTRON_EXE;

export const newProfile = () => mkdtempSync(join(tmpdir(), 'bdb-test-'));

export async function launchApp(profile = newProfile()) {
  const exe = process.env.ELECTRON_EXE;
  const args = exe ? [] : ['.'];
  if (process.platform === 'linux') args.push('--no-sandbox');
  args.push(`--user-data-dir=${profile}`);
  const app = await _electron.launch({ executablePath: exe || require('electron'), args });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(e.message));
  await win.waitForFunction(
    () => window.__engine && ['factory:kick', 'factory:metro-hi'].every((id) => window.__engine.sampleStatus(id) === 'ok'),
    null,
    { timeout: 30000 },
  );
  return { app, win, profile, pageErrors };
}

/** Close the window like a user would. Answers "Don't save" if asked. Returns whether it asked. */
export async function closeApp(app, win) {
  const closed = new Promise((r) => app.process().once('exit', r));
  await app.evaluate(({ BrowserWindow }) => void BrowserWindow.getAllWindows()[0]?.close());
  const asked = await win
    .waitForSelector('.modal[aria-label="Save changes?"]', { timeout: 3000 })
    .then(() => true, () => false);
  // The window closes during the click, which Playwright reports as an error.
  if (asked) await win.click('.modal button:has-text("Don\'t save")').catch(() => {});
  await closed;
  return asked;
}

/** Replace the native save/open dialogs in the main process so UI flows can run unattended. */
export async function stubDialogs(app, { savePath, openPath }) {
  await app.evaluate(
    ({ dialog }, { savePath, openPath }) => {
      dialog.showSaveDialog = async () => (savePath ? { canceled: false, filePath: savePath } : { canceled: true });
      dialog.showOpenDialog = async () => (openPath ? { canceled: false, filePaths: [openPath] } : { canceled: true, filePaths: [] });
    },
    { savePath, openPath },
  );
}

export async function systemInfo(app) {
  return app.evaluate(({ app }) => {
    const os = process.mainModule.require('os');
    return {
      appVersion: app.getVersion(),
      packaged: app.isPackaged,
      electron: process.versions.electron,
      platform: process.platform,
      osVersion: process.getSystemVersion?.() ?? os.release(),
      cpu: os.cpus()[0]?.model,
      cores: os.cpus().length,
      memGB: +(os.totalmem() / 2 ** 30).toFixed(1),
    };
  });
}

/** Collects named pass/fail checks for one test file. */
export function suite(name) {
  const checks = [];
  const info = {};
  return {
    name,
    checks,
    info,
    check(label, ok, detail) {
      checks.push({ label, ok: !!ok, detail });
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail !== undefined ? `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
    },
    note(key, value) {
      info[key] = value;
    },
    get passed() {
      return checks.length > 0 && checks.every((c) => c.ok);
    },
  };
}

/** Run a test's `run(suite)` when the file is executed directly. */
export async function runStandalone(importMetaUrl, name, run) {
  const { pathToFileURL } = await import('node:url');
  if (importMetaUrl !== pathToFileURL(process.argv[1]).href) return;
  const s = suite(name);
  console.log(`\n${name}`);
  try {
    await run(s);
  } catch (e) {
    s.check('test ran to completion', false, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
  }
  console.log(s.passed ? `${name}: all ${s.checks.length} checks passed` : `${name}: FAILED`);
  process.exit(s.passed ? 0 : 1);
}

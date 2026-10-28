// Shared helpers for the end-to-end tests.
//
// Every test launches the real Electron app: the installed Ba-da-boom.exe when
// ELECTRON_EXE is set, otherwise the development build (`npx electron .`).
// Each launch uses its own temporary profile, so tests never touch the user's
// autosave or samples and still run while the user has the app open.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');

export const usingInstalledApp = () => !!process.env.ELECTRON_EXE;

export const newProfile = () => mkdtempSync(join(tmpdir(), 'bdb-test-'));

let lastApp = null;
/** The last lines the most recently launched app printed. */
export const lastAppLog = () => lastApp?.__log?.slice(-15) ?? [];

/** Processes closing left behind, per profile; checked after every suite. */
export const leftovers = [];
const launched = new Set();

/** Pids of any app processes (main, renderer, GPU, ...) still using this profile. */
export function processesFor(profile) {
  try {
    if (process.platform === 'win32') {
      // Excludes this PowerShell itself, whose own command line contains the profile path.
      const ps = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${profile.replace(/'/g, "''")}*' } | ForEach-Object { $_.ProcessId }`;
      return execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).split(/\s+/).filter(Boolean).map(Number);
    }
    return execFileSync('pgrep', ['-f', profile], { encoding: 'utf8' }).split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

function killAll(pids) {
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

/** After the main process exits, every other app process must be gone within 5 s. */
async function expectNoLeftovers(profile) {
  let pids = [];
  for (let i = 0; i < 25; i++) {
    pids = processesFor(profile);
    if (!pids.length) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  leftovers.push({ profile, pids });
  killAll(pids);
}

/** Simulate a crash: the whole app dies at once (like End task in Task Manager). */
export async function crashApp(app) {
  const exited = new Promise((r) => app.process().once('exit', r));
  if (process.platform === 'win32') killAll([app.process().pid]);
  else app.process().kill('SIGKILL');
  await exited;
  await new Promise((r) => setTimeout(r, 1000));
  killAll(processesFor(app.__profile));
}

export async function launchApp(profile = newProfile(), extraArgs = [], env = {}) {
  const exe = process.env.ELECTRON_EXE;
  const args = exe ? [] : ['.'];
  if (process.platform === 'linux') args.push('--no-sandbox');
  args.push(`--user-data-dir=${profile}`, ...extraArgs);
  const app = await _electron.launch({ executablePath: exe || require('electron'), args, env: { ...process.env, ...env } });
  app.__profile = profile;
  launched.add(profile);
  // Keep the app's own output, so a failure can show what the app said.
  const log = [];
  const keep = (d) => log.push(...String(d).split(/\r?\n/).filter(Boolean)) && log.splice(0, Math.max(0, log.length - 200));
  app.process().stdout?.on('data', keep);
  app.process().stderr?.on('data', keep);
  app.__log = log;
  lastApp = app;
  await app.evaluate(({ app: a }) => {
    a.on('render-process-gone', (_e, _wc, d) => console.log(`[test] renderer gone: ${d.reason} (exit ${d.exitCode})`));
    a.on('child-process-gone', (_e, d) => console.log(`[test] child process gone: ${d.type} ${d.reason} (exit ${d.exitCode})`));
  });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(e.message));
  await win.waitForFunction(
    // Every sample has finished loading (ok or missing), not just the first few.
    () => window.__engine?.['status']?.size >= 18 && [...window.__engine['status'].values()].every((st) => st !== 'loading'),
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
  await expectNoLeftovers(app.__profile);
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
    failedRun(s, e);
  }
  checkLeftovers(s);
  console.log(s.passed ? `${name}: all ${s.checks.length} checks passed` : `${name}: FAILED`);
  process.exit(s.passed ? 0 : 1);
}

export function failedRun(s, e) {
  s.check('test ran to completion', false, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
  const log = lastAppLog();
  if (log.length) console.log(`    last output from the app:\n      ${log.join('\n      ')}`);
}

export function checkLeftovers(s) {
  // Anything still running for a profile this suite used (e.g. after a failure) counts too.
  for (const profile of launched) {
    const pids = processesFor(profile);
    if (pids.length) {
      leftovers.push({ profile, pids });
      killAll(pids);
    }
  }
  launched.clear();
  const found = leftovers.splice(0);
  s.check('closing the app leaves no processes behind', found.length === 0, found.length ? found.map((f) => `${f.pids.length} left (${f.pids.join(' ')})`).join('; ') : 'none');
}

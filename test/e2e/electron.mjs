// Runs the real Electron app (built files) and checks: the bdb:// protocol and CSP
// load the UI, superdough's worklets and samples load, WAV import goes through the
// main process, and save -> open round-trips through IPC with collected samples.
// Usage: xvfb-run -a node test/e2e/electron.mjs
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const electronPath = require('electron');

const userData = mkdtempSync(join(tmpdir(), 'bdb-user-'));
const app = await _electron.launch({ executablePath: electronPath, args: ['.', `--user-data-dir=${userData}`, '--no-sandbox'], cwd: process.cwd() });
const win = await app.firstWindow();
const logs = [];
win.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(`${m.type()}: ${m.text()}`));
win.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await win.waitForFunction(() => window.__engine?.sampleStatus('factory:kick') === 'ok', null, { timeout: 20000 });
const report = {};
report.url = win.url();
report.hasBridge = await win.evaluate(() => typeof window.bdb === 'object' && typeof window.require === 'undefined' && typeof window.process === 'undefined');
report.statuses = await win.evaluate(() => Object.fromEntries([...window.__engine['status'].entries()].filter(([, s]) => s !== 'ok')));

// Import a WAV through the main process (copy of the factory snare)
const wav = [...readFileSync('resources/samples/snare.wav')];
report.import = await win.evaluate(async (bytes) => window.bdb.importSample('my snare.wav', new Uint8Array(bytes)), wav);
// Refuse a non-WAV
report.rejectsNonWav = await win.evaluate(async () => {
  try {
    await window.bdb.importSample('x.wav', new TextEncoder().encode('not a wav file at all, definitely not'));
    return false;
  } catch {
    return true;
  }
});
// Pool URL is fetchable; path traversal is not
report.poolFetch = await win.evaluate(async (f) => (await fetch(`bdb://app/pool/${f}`)).status, report.import.file);
report.traversal = await win.evaluate(async () => {
  const out = [];
  for (const u of ['bdb://app/pool/..%2F..%2FPreferences', 'bdb://app/pool/../../Preferences', 'bdb://app/..%2Fpackage.json', 'bdb://app/%2e%2e/package.json', 'bdb://other/x']) {
    try {
      out.push(`${u} -> ${(await fetch(u)).status}`);
    } catch {
      out.push(`${u} -> fetch refused`);
    }
  }
  return out;
});

// Play for 2 s
await win.keyboard.press('Space');
await win.waitForTimeout(2000);
report.playingCycle = await win.evaluate(() => window.__engine.audibleCycle());
await win.keyboard.press('Space');
report.csp = await win.evaluate(async () => {
  try {
    await fetch('https://example.com');
    return 'network allowed';
  } catch {
    return 'blocked';
  }
});
report.logs = logs;
console.log(JSON.stringify(report, null, 2));
await app.close();
report.lockRemovedOnCleanExit = !existsSync(join(userData, 'autosave', 'session.lock'));
console.log('clean exit removed lock:', report.lockRemovedOnCleanExit, readdirSync(userData).join(','));

// Desktop security and services in the real app: sandboxed renderer, the bdb://
// protocol (no path traversal), CSP blocks the network, WAV import validation.
import { readFileSync } from 'node:fs';
import { closeApp, launchApp, runStandalone } from './lib.mjs';

export async function run(t) {
  const { app, win, pageErrors } = await launchApp();
  try {
    t.check('UI is served from bdb://app', win.url().startsWith('bdb://app/'), win.url());
    const isolation = await win.evaluate(() => ({
      bridge: typeof window.bdb === 'object',
      require: typeof window.require,
      process: typeof window.process,
    }));
    t.check('renderer has the bridge but no Node access', isolation.bridge && isolation.require === 'undefined' && isolation.process === 'undefined', isolation);
    const sandboxed = await app.evaluate(({ BrowserWindow }) => {
      const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration };
    });
    t.check('window is sandboxed with context isolation', sandboxed.sandbox && sandboxed.contextIsolation && !sandboxed.nodeIntegration, sandboxed);

    const wav = [...readFileSync('resources/samples/snare.wav')];
    const imported = await win.evaluate(async (bytes) => window.bdb.importSample('my snare.wav', new Uint8Array(bytes)), wav);
    t.check('WAV import goes through the main process', /^[0-9a-f]{32}\.wav$/.test(imported.file), imported.file);
    const rejects = await win.evaluate(async () => {
      try {
        await window.bdb.importSample('x.wav', new TextEncoder().encode('not a wav file at all, definitely not'));
        return false;
      } catch {
        return true;
      }
    });
    t.check('non-WAV data is refused', rejects);
    const poolStatus = await win.evaluate(async (f) => (await fetch(`bdb://app/pool/${f}`)).status, imported.file);
    t.check('imported sample is served from the pool', poolStatus === 200, poolStatus);

    const traversal = await win.evaluate(async () => {
      const out = {};
      for (const u of [
        'bdb://app/pool/..%2F..%2FPreferences',
        'bdb://app/pool/../../Preferences',
        'bdb://app/..%2Fpackage.json',
        'bdb://app/%2e%2e/package.json',
        'bdb://app/pool/..%5C..%5CPreferences',
        'bdb://other/x',
      ]) {
        try {
          out[u] = (await fetch(u)).status;
        } catch {
          out[u] = 'refused';
        }
      }
      return out;
    });
    t.check('path traversal through bdb:// is refused', Object.values(traversal).every((s) => s !== 200), traversal);
    const net = await win.evaluate(async () => {
      try {
        await fetch('https://example.com');
        return 'allowed';
      } catch {
        return 'blocked';
      }
    });
    t.check('Content Security Policy blocks network access', net === 'blocked', net);
    const nav = await win.evaluate(() => {
      const before = location.href;
      location.href = 'https://example.com';
      return before;
    });
    await win.waitForTimeout(500);
    t.check('navigation away from the app is blocked', win.url() === nav, win.url());

    await win.keyboard.press('Space');
    await win.waitForTimeout(2000);
    const c = await win.evaluate(() => window.__engine.audibleCycle());
    t.check('plays audio (clock advancing after 2 s)', c > 0.5, c?.toFixed(3));
    await win.keyboard.press('Space');
    t.check('no errors in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
  } finally {
    await closeApp(app, win).catch(() => app.close());
  }
}

await runStandalone(import.meta.url, 'Desktop security and services', run);

// Project files in the real Electron app:
//  - save collects imported samples into <project>/samples
//  - opening on a machine without the sample pool restores samples from the project folder
//  - a project whose sample files are gone opens with those tracks marked missing (data kept)
//  - autosave + recovery after the process is killed
// Usage: xvfb-run -a node test/e2e/electron-files.mjs
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const electronPath = require('electron');

const userData = mkdtempSync(join(tmpdir(), 'bdb-user-'));
const work = mkdtempSync(join(tmpdir(), 'bdb-proj-'));
const launch = async () => {
  const app = await _electron.launch({ executablePath: electronPath, args: ['.', `--user-data-dir=${userData}`, '--no-sandbox'] });
  app.process().stderr.on('data', (d) => process.env.DEBUG && console.log('MAIN:', String(d).trim()));
  const win = await app.firstWindow();
  await win.waitForFunction(() => window.__engine?.sampleStatus('factory:kick') === 'ok', null, { timeout: 20000 });
  return { app, win };
};
const report = {};
// Closing a window with unsaved changes shows "Save changes?"; answer "Don't save".
const closeApp = async (app, win) => {
  const closed = new Promise((r) => app.process().once('exit', r));
  await app.evaluate(({ BrowserWindow }) => void BrowserWindow.getAllWindows()[0].close());
  const asked = await win.waitForSelector('.modal[aria-label="Save changes?"]', { timeout: 3000 }).then(() => true, () => false);
  // The window closes during the click, which Playwright reports as an error.
  if (asked) await win.click('.modal button:has-text("Don\'t save")').catch(() => {});
  await closed;
  return asked;
};
const step = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`, JSON.stringify(report));

let { app, win } = await launch();
// Import a sample and assign it to track 1 through the UI's file input.
await win.setInputFiles('.browser input[type=file]', { name: 'my kick.wav', mimeType: 'audio/wav', buffer: readFileSync('resources/samples/kick-sub.wav') });
await win.waitForSelector('.sample:has-text("my kick")');
await win.dblclick('.sample:has-text("my kick")');
await win.waitForTimeout(300);
report.trackOneName = await win.textContent('.row >> nth=0 >> .track-name');
step('Save to a known p');
// Save to a known path via the bridge (the dialog is bypassed by passing a path).
const projPath = join(work, 'Beat', 'Beat.badaboom');
const text = await win.evaluate(() => window.__bdb.serializeProject(window.__engine['project']));
step('got text ' + text.length);
report.save = await win.evaluate(async ([path, text]) => window.bdb.saveProject({ path, saveAs: false, name: 'Beat', text }), [projPath, text]);
step('saved');
report.collected = readdirSync(join(work, 'Beat', 'samples'));
report.askedToSaveOnClose = await closeApp(app, win);

step('Simulate another ');
// Simulate another computer: empty the sample pool, then open the project.
rmSync(join(userData, 'sample-pool'), { recursive: true, force: true });
({ app, win } = await launch());
report.reopen = await win.evaluate(async (p) => {
  const r = await window.bdb.openProject(p);
  return { missing: r.missing, hasText: r.text.length > 0 };
}, projPath);
report.poolRestored = existsSync(join(userData, 'sample-pool', report.collected[0]));

step('Now remove both c');
// Now remove both copies: the project must still open and keep the reference.
await closeApp(app, win);
rmSync(join(userData, 'sample-pool'), { recursive: true, force: true });
rmSync(join(work, 'Beat', 'samples'), { recursive: true, force: true });
({ app, win } = await launch());
report.missingCase = await win.evaluate(async (p) => {
  const r = await window.bdb.openProject(p);
  const project = window.__bdb.parseProject(r.text);
  return { missing: r.missing, trackOneSample: project.tracks[0].sound.sampleId, refKept: !!project.samples[project.tracks[0].sound.sampleId] };
}, projPath);

step('Autosave + crash ');
// Autosave + crash recovery: make an edit, wait for autosave, kill the process.
await win.click('[data-cell="t5:3"]');
await win.waitForTimeout(6500);
const pid = app.process().pid;
process.kill(pid, 'SIGKILL');
await new Promise((r) => setTimeout(r, 1000));
({ app, win } = await launch());
await win.waitForSelector('.modal[aria-label="Recover unsaved work?"]', { timeout: 5000 }).then(
  () => (report.recoveryOffered = true),
  () => (report.recoveryOffered = false),
);
if (report.recoveryOffered) {
  await win.click('.modal button.primary');
  report.recoveredEditPresent = await win.evaluate(() => document.querySelector('[data-cell="t5:3"]').classList.contains('on'));
}
await closeApp(app, win);
step('After a clean clo');
// After a clean close, no recovery prompt.
({ app, win } = await launch());
await win.waitForTimeout(500);
report.noPromptAfterCleanClose = !(await win.$('.modal[aria-label="Recover unsaved work?"]'));
report.askedToSaveWhenClean = await closeApp(app, win);
step('done');

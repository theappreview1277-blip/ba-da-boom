// Project files opened from Windows (double-click, or dropped on the app icon) and
// the error log: the app opens a file it is started with, a file double-clicked
// while it is open (asking first if there are unsaved changes), offers it after a
// crash next to recovery, refuses paths the renderer makes up, and writes a log.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeApp, crashApp, launchApp, newProfile, runStandalone } from './lib.mjs';

const require = createRequire(import.meta.url);

/** Start a second copy of the app with a file, like double-clicking it while the app is open. */
function secondLaunch(profile, file) {
  const exe = process.env.ELECTRON_EXE || require('electron');
  const args = process.env.ELECTRON_EXE ? [] : ['.'];
  if (process.platform === 'linux') args.push('--no-sandbox');
  args.push(`--user-data-dir=${profile}`, file);
  const child = spawn(exe, args, { stdio: 'ignore' });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 15000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

const projectState = (win) => win.evaluate(() => ({ bpm: window.__engine['project'].bpm, track: window.__engine['project'].tracks[0].name }));

export async function run(t) {
  const work = newProfile();
  const profile = newProfile();

  // Make three project files from a fresh project, each with its own tempo and first track name.
  let { app, win, pageErrors } = await launchApp(profile);
  const base = await win.evaluate(() => window.__bdb.serializeProject(window.__engine['project']));
  await closeApp(app, win);
  const make = (name, bpm) => {
    const p = JSON.parse(base);
    p.name = name;
    p.bpm = bpm;
    p.tracks[0].name = `${name} kick`;
    const path = join(work, `${name}.badaboom`);
    writeFileSync(path, JSON.stringify(p));
    return path;
  };
  const first = make('First', 97);
  const second = make('Second', 133);
  const third = make('Third', 88);

  // 1. Started with a file, as Windows does on a double-click.
  ({ app, win, pageErrors } = await launchApp(profile, [first]));
  await win.waitForFunction(() => window.__engine['project'].bpm === 97, null, { timeout: 10000 }).catch(() => {});
  t.check('a project file the app is started with is opened', (await projectState(win)).track === 'First kick', await projectState(win));
  const status = await win.textContent('.statusbar');
  t.check('its path is shown and nothing is unsaved', status.includes('First.badaboom') && !status.includes('unsaved'), status);

  // 2. Double-clicked while the app is open: the open window takes it, the second copy closes.
  const exited = await secondLaunch(profile, second);
  t.check('a second copy of the app hands the file over and closes', exited);
  await win.waitForFunction(() => window.__engine['project'].bpm === 133, null, { timeout: 10000 }).catch(() => {});
  t.check('the open window opens the double-clicked file', (await projectState(win)).track === 'Second kick', await projectState(win));

  // 3. With unsaved changes it asks first, naming the file.
  await win.click('[data-cell^="t1:"][data-step="2"]');
  await secondLaunch(profile, third);
  const modal = await win.waitForSelector('.modal[aria-label="Save changes?"]', { timeout: 5000 }).catch(() => null);
  t.check('with unsaved changes it asks before opening the file', !!modal && (await modal.textContent()).includes('Third.badaboom'), modal ? await modal.textContent() : 'no dialog');
  if (modal) await win.click('.modal button:has-text("Don\'t save")');
  await win.waitForFunction(() => window.__engine['project'].bpm === 88, null, { timeout: 10000 }).catch(() => {});
  t.check('"Don\'t save" then opens it', (await projectState(win)).track === 'Third kick', await projectState(win));

  // 4. The window cannot open files Windows did not hand over.
  writeFileSync(join(work, 'secret.badaboom'), base);
  const refused = await win.evaluate((p) => window.bdb.openProject(p).then(() => 'opened', (e) => String(e.message)), join(work, 'secret.badaboom'));
  t.check('a path the window makes up is refused', refused.includes('not opened through Windows'), refused);

  // 5. Error log.
  const logPath = join(profile, 'logs', 'badaboom.log');
  await win.evaluate(() => window.bdb.log('error', 'test marker 4711'));
  await win.evaluate(() => {
    setTimeout(() => {
      throw new Error('uncaught test error 815');
    });
  });
  await win.waitForTimeout(800);
  await win.evaluate(async () => {
    for (let i = 0; i < 150; i++) await window.bdb.log('error', `flood ${i}`);
  });
  let text = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  t.check('the error log is written to the app data folder', text.includes('starting'), logPath);
  t.check('files opened from Windows are logged', text.includes(`Opening ${second} from Windows`));
  t.check('the window can write problems to the log', text.includes('test marker 4711'));
  const flood = (text.match(/flood \d+/g) ?? []).length;
  t.check('the window cannot flood the log (at most 100 lines a minute)', flood > 0 && flood <= 100, `${flood} of 150 written`);
  text = readFileSync(logPath, 'utf8');
  t.check('uncaught errors in the window are logged', text.includes('uncaught test error 815'));
  await win.click('button.about');
  const showLog = await win.waitForSelector('.modal button:has-text("Show error log")', { timeout: 3000 }).catch(() => null);
  t.check('About has a "Show error log" button', !!showLog);
  await win.click('.modal button:has-text("Close")');
  // Only the deliberate error above may have reached the page.
  t.check('no other page errors', pageErrors.filter((e) => !e.includes('815')).length === 0, pageErrors.join(' | ') || 'none');

  // 6. After a crash, recovery is offered first, with the double-clicked file as the alternative.
  await win.click('[data-cell^="t1:"][data-step="5"]');
  await win.waitForTimeout(6000); // autosave runs every 5 s
  await crashApp(app);
  ({ app, win, pageErrors } = await launchApp(profile, [first]));
  const rec = await win.waitForSelector('.modal[aria-label="Recover unsaved work?"]', { timeout: 5000 }).catch(() => null);
  const openBtn = rec && (await win.$('.modal button:has-text("Open First.badaboom")'));
  t.check('after a crash, recovery is offered with the file as the other choice', !!openBtn, rec ? await rec.textContent() : 'no recovery dialog');
  if (openBtn) await openBtn.click();
  await win.waitForFunction(() => window.__engine['project'].bpm === 97, null, { timeout: 10000 }).catch(() => {});
  t.check('choosing the file opens it', (await projectState(win)).track === 'First kick', await projectState(win));
  await closeApp(app, win);
  text = readFileSync(logPath, 'utf8');
  t.check('a normal close is logged', text.trimEnd().endsWith('Closed normally'), text.trimEnd().split('\n').pop());
  t.check('no page errors after the crash', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
}

await runStandalone(import.meta.url, 'Opening files from Windows and the error log', run);

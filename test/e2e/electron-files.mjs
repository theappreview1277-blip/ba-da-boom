// Projects through the real UI (native dialogs answered automatically):
// save collects samples, reopen on a machine without the sample pool, missing
// samples are flagged and relinkable, crash recovery, newer-format refusal.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeApp, launchApp, newProfile, runStandalone, stubDialogs } from './lib.mjs';

export async function run(t) {
  const profile = newProfile();
  const work = newProfile();
  const projPath = join(work, 'Beat', 'Beat.badaboom');
  const kick = readFileSync('resources/samples/kick-sub.wav');
  const importAndAssign = async (win, name) => {
    await win.click('.row >> nth=0 >> .track-head');
    await win.setInputFiles('.browser input[type=file]', { name, mimeType: 'audio/wav', buffer: kick });
    const label = name.replace(/\.wav$/, '');
    await win.waitForSelector(`.sample:has-text("${label}")`);
    await win.dblclick(`.sample:has-text("${label}")`);
    await win.waitForTimeout(300);
  };

  // 1. Import, assign, save through the Save dialog.
  let { app, win, pageErrors } = await launchApp(profile);
  await importAndAssign(win, 'my kick.wav');
  t.check('imported sample is assigned to track 1', (await win.textContent('.row >> nth=0 >> .track-name'))?.includes('my kick'));
  await stubDialogs(app, { savePath: join(work, 'Beat.badaboom') });
  await win.keyboard.press('Control+s');
  await win.waitForFunction(() => !document.querySelector('.statusbar')?.textContent?.includes('unsaved'), null, { timeout: 10000 }).catch(() => {});
  t.check('Save creates <name>/<name>.badaboom', existsSync(projPath), projPath);
  const collected = existsSync(join(work, 'Beat', 'samples')) ? readdirSync(join(work, 'Beat', 'samples')) : [];
  t.check('Save copies the imported sample into the project folder', collected.length === 1, collected);
  t.check('status bar shows the saved path, no unsaved changes', !(await win.textContent('.statusbar')).includes('unsaved'));
  t.check('closing a saved project does not ask to save', (await closeApp(app, win)) === false);
  t.check('no page errors (save)', pageErrors.length === 0, pageErrors.join(' | ') || 'none');

  // 2. Another computer: empty pool, open through the Open dialog.
  rmSync(join(profile, 'sample-pool'), { recursive: true, force: true });
  ({ app, win, pageErrors } = await launchApp(profile));
  await stubDialogs(app, { openPath: projPath });
  await win.keyboard.press('Control+o');
  await win.waitForTimeout(1500);
  t.check('reopened project shows the imported sample on track 1', (await win.textContent('.row >> nth=0 >> .track-name'))?.includes('my kick'));
  t.check('sample restored from the project folder (no missing badge)', !(await win.$('.row >> nth=0 >> .badge.warn')));
  t.check('sample copied back into the pool', existsSync(join(profile, 'sample-pool', collected[0] ?? 'none')));

  // 3. Sample gone everywhere: project still opens, track flagged, reference kept, relinkable.
  await closeApp(app, win);
  rmSync(join(profile, 'sample-pool'), { recursive: true, force: true });
  rmSync(join(work, 'Beat', 'samples'), { recursive: true, force: true });
  ({ app, win, pageErrors } = await launchApp(profile));
  await stubDialogs(app, { openPath: projPath });
  await win.keyboard.press('Control+o');
  await win.waitForSelector('.row >> nth=0 >> .badge.warn', { timeout: 5000 }).catch(() => {});
  t.check('track with a missing sample is marked "missing"', !!(await win.$('.row >> nth=0 >> .badge.warn')));
  t.check('status bar reports missing samples', (await win.textContent('.statusbar')).includes('missing'));
  const ref = await win.evaluate(() => {
    const p = window.__engine['project'];
    const id = p.tracks[0].sound.sampleId;
    return { id, kept: !!p.samples[id] };
  });
  t.check('the missing sample reference is kept, not discarded', ref.id?.startsWith('user:') && ref.kept, ref);
  await win.keyboard.press('Space');
  await win.waitForTimeout(1200);
  t.check('project with a missing sample still plays', await win.evaluate(() => window.__engine.isPlaying && window.__engine.audibleCycle() > 0.2));
  await win.keyboard.press('Space');
  await importAndAssign(win, 'replacement kick.wav');
  t.check('relinking by assigning a new WAV clears the missing flag', !(await win.$('.row >> nth=0 >> .badge.warn')));

  // 4. Newer file format is refused without losing the open project.
  const newer = JSON.parse(readFileSync(projPath, 'utf8'));
  newer.version = 99;
  const newerPath = join(work, 'Future.badaboom');
  writeFileSync(newerPath, JSON.stringify(newer));
  const before = await win.evaluate(() => window.__engine['project'].tracks[0].name);
  await stubDialogs(app, { openPath: newerPath });
  await win.keyboard.press('Control+o');
  await win.waitForSelector('.modal[aria-label="Save changes?"]', { timeout: 2000 }).then(() => win.click('.modal button:has-text("Don\'t save")')).catch(() => {});
  await win.waitForTimeout(800);
  t.check('a file from a newer version is refused with a message', (await win.textContent('.toast').catch(() => ''))?.includes('newer version'));
  t.check('the open project is untouched after the refusal', (await win.evaluate(() => window.__engine['project'].tracks[0].name)) === before);
  t.check('no page errors (open/missing)', pageErrors.length === 0, pageErrors.join(' | ') || 'none');

  // 5. Crash recovery: edit, wait for autosave, kill the process.
  await win.click('[data-cell="t5:3"]');
  await win.waitForTimeout(6500);
  const exited = new Promise((r) => app.process().once('exit', r));
  app.process().kill('SIGKILL');
  await exited;
  await new Promise((r) => setTimeout(r, 1500));
  ({ app, win, pageErrors } = await launchApp(profile));
  const offered = await win.waitForSelector('.modal[aria-label="Recover unsaved work?"]', { timeout: 5000 }).then(() => true, () => false);
  t.check('after a crash, recovery is offered', offered);
  if (offered) {
    await win.click('.modal button.primary');
    t.check('recovered project contains the last edit', await win.evaluate(() => document.querySelector('[data-cell="t5:3"]').classList.contains('on')));
  }
  t.check('closing recovered (unsaved) work asks to save', await closeApp(app, win));

  // 6. Clean close: no recovery prompt next time.
  ({ app, win, pageErrors } = await launchApp(profile));
  await win.waitForTimeout(800);
  t.check('after a clean close, no recovery prompt', !(await win.$('.modal[aria-label="Recover unsaved work?"]')));
  await closeApp(app, win);
}

await runStandalone(import.meta.url, 'Projects, missing samples and recovery', run);

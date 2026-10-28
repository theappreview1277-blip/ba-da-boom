// Pattern generators through the real UI: Euclidean rhythms, locked steps,
// seeded randomise (track and all tracks), undo, and locks surviving save/open.
import { join } from 'node:path';
import { closeApp, launchApp, newProfile, runStandalone, stubDialogs } from './lib.mjs';

export async function run(t) {
  const { app, win, pageErrors } = await launchApp();
  try {
    const lane = (track) =>
      win.evaluate((track) => {
        const p = window.__engine['project'];
        const l = p.patterns.find((x) => x.id === p.currentPatternId).lanes[track];
        return { length: l.length, on: l.steps.map((s) => (s.on ? 'x' : '.')).join(''), locked: l.steps.flatMap((s, i) => (s.locked ? [i] : [])) };
      }, track);
    const slider = (block, label) => win.locator(`.generate [aria-label="${block}"] .slider:has(label:text-is("${label}")) input`);
    const allLanes = () => win.evaluate(() => JSON.stringify(window.__engine['project'].patterns.map((p) => p.lanes)));

    // Euclidean: 3 hits over 8 steps on track 5.
    await win.click('.row >> nth=4 >> .track-name');
    await slider('Euclidean', 'Steps').fill('8');
    await slider('Euclidean', 'Hits').fill('3');
    await slider('Euclidean', 'Rotate').fill('0');
    const preview = await win.getAttribute('.euclid-preview', 'aria-label');
    t.check('preview shows the 3-in-8 tresillo', preview?.endsWith('x..x..x.'), preview);
    await win.click('.generate button:has-text("Apply to track")');
    await win.waitForTimeout(200);
    let l = await lane('t5');
    t.check('Apply writes the rhythm into the grid', l.on.startsWith('x..x..x.'), l.on.slice(0, 16));
    t.check('track length set to the step count', l.length === 8, l.length);
    const cells = await win.evaluate(() => [...Array(8).keys()].map((i) => (document.querySelector(`[data-cell="t5:${i}"]`).classList.contains('on') ? 'x' : '.')).join(''));
    t.check('grid shows the new steps', cells === 'x..x..x.', cells);
    await slider('Euclidean', 'Rotate').fill('2');
    await win.click('.generate button:has-text("Apply to track")');
    await win.waitForTimeout(200);
    l = await lane('t5');
    t.check('rotation shifts the rhythm (same as Strudel euclidRot 3,8,2)', l.on.startsWith('x.x..x..'), l.on.slice(0, 8));

    // Lock a step, then randomise the track to empty: the locked hit stays.
    await win.click('[data-cell="t5:2"]', { modifiers: ['Shift'] });
    await win.keyboard.press('l');
    l = await lane('t5');
    t.check('L locks the selected step', l.locked.includes(2), l.locked);
    t.check('locked step is marked in the grid', await win.evaluate(() => document.querySelector('[data-cell="t5:2"]').classList.contains('locked')));
    const others = await win.evaluate(() => JSON.stringify(Object.entries(window.__engine['project'].patterns[0].lanes).filter(([k]) => k !== 't5')));
    await slider('Randomise', 'Strength').fill('1');
    await slider('Randomise', 'Density').fill('0');
    await win.click('.generate [aria-label="Randomise"] button:has-text("Apply")');
    await win.waitForTimeout(200);
    l = await lane('t5');
    t.check('randomise at 100% strength, 0% density clears everything but the locked step', l.on.slice(0, 8) === '..x.....', l.on.slice(0, 8));
    t.check('randomising one track leaves the other tracks alone', others === (await win.evaluate(() => JSON.stringify(Object.entries(window.__engine['project'].patterns[0].lanes).filter(([k]) => k !== 't5')))));

    // Undo brings back the Euclidean rhythm.
    await win.keyboard.press('Control+z');
    await win.waitForTimeout(200);
    l = await lane('t5');
    t.check('undo restores the lane in one step', l.on.slice(0, 8) === 'x.x..x..', l.on.slice(0, 8));

    // Reproducible: the same seed and settings twice give the same result.
    await slider('Randomise', 'Density').fill('0.5');
    await win.fill('#gen-seed', '7');
    await win.click('.generate [aria-label="Randomise"] button:has-text("Apply")');
    await win.waitForTimeout(200);
    const first = (await lane('t5')).on;
    await win.keyboard.press('Control+z');
    await win.click('.generate [aria-label="Randomise"] button:has-text("Apply")');
    await win.waitForTimeout(200);
    const again = (await lane('t5')).on;
    t.check('same seed gives the same result', first === again, first.slice(0, 8));
    await win.click('.generate button:has-text("New")');
    await win.waitForTimeout(200);
    const seedNow = await win.inputValue('#gen-seed');
    const next = (await lane('t5')).on;
    t.check('the dice button moves to the next seed and gives a different result', seedNow === '8' && next !== first, `seed ${seedNow}`);

    // All tracks.
    const before = await allLanes();
    await win.selectOption('.generate select[aria-label="Randomise scope"]', 'pattern');
    await win.click('.generate [aria-label="Randomise"] button:has-text("Apply")');
    await win.waitForTimeout(200);
    const changed = await win.evaluate((before) => {
      const b = JSON.parse(before);
      const p = window.__engine['project'];
      const i = p.patterns.findIndex((x) => x.id === p.currentPatternId);
      return Object.keys(p.patterns[i].lanes).filter((k) => JSON.stringify(p.patterns[i].lanes[k]) !== JSON.stringify(b[i][k])).length;
    }, before);
    t.check('"All tracks" randomises every track', changed >= 12, `${changed} of 16 lanes changed`);
    l = await lane('t5');
    t.check('locked step still kept', l.locked.includes(2) && l.on[2] === 'x');

    // It plays: the changed pattern is what the engine hears.
    await win.keyboard.press('Space');
    await win.waitForTimeout(1200);
    t.check('generated pattern plays', await win.evaluate(() => window.__engine.isPlaying && window.__engine.audibleCycle() > 0.2));
    await win.keyboard.press('Space');

    // Locks are saved in the project file.
    const work = newProfile();
    await stubDialogs(app, { savePath: join(work, 'Gen.badaboom') });
    await win.keyboard.press('Control+s');
    await win.waitForFunction(() => !document.querySelector('.statusbar')?.textContent?.includes('unsaved'), null, { timeout: 10000 }).catch(() => {});
    await stubDialogs(app, { openPath: join(work, 'Gen', 'Gen.badaboom') });
    await win.keyboard.press('Control+o');
    await win.waitForTimeout(1500);
    l = await lane('t5');
    t.check('locked step is still locked after save and reopen', l.locked.includes(2), l.locked);
    t.check('no errors in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
  } finally {
    await closeApp(app, win).catch(() => app.close());
  }
}

await runStandalone(import.meta.url, 'Pattern generators', run);

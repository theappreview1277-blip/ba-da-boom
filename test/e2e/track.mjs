// Track beat intelligence through the real UI: build a whole track from a
// style, check its sections and timeline, export it, edit the section plan,
// give one section a new take, undo, save and reopen, then play a whole
// drum & bass track from start to finish (about 3 minutes) and check every
// section is heard in order, the sound never drops out, the audio keeps up
// and the track stops by itself after the outro.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { closeApp, launchApp, newProfile, openTool, runStandalone, stubDialogs } from './lib.mjs';

const SECONDS_LIMIT = Number(process.env.BDB_TRACKPLAY_SECONDS ?? 240);

export async function run(t) {
  const { app, win, profile, pageErrors } = await launchApp();
  win.setDefaultTimeout(15000);
  try {
    await openTool(win, 'Whole track');
    const sleep = (ms) => win.waitForTimeout(ms);
    const pick = (label, value) => win.selectOption(`.trackbuilder select[aria-label="${label}"]`, value);
    const state = () =>
      win.evaluate(() => {
        const p = window.__engine['project'];
        const name = (id) => p.patterns.find((x) => x.id === id)?.name;
        return {
          bpm: p.bpm,
          loop: p.songLoop,
          song: p.song.map((e) => ({ id: e.patternId, name: name(e.patternId), bars: e.bars })),
          patterns: p.patterns.map((x) => ({ id: x.id, name: x.name, lanes: JSON.stringify(x.lanes) })),
          current: name(p.currentPatternId),
        };
      });
    const timeline = () => win.locator('.trackbuilder .tl-section').evaluateAll((els) => els.map((e) => `${e.querySelector('span').textContent}${e.querySelector('small').textContent}`));
    const songPressed = () => win.evaluate(() => document.querySelector('.songbar .mode button:last-child').getAttribute('aria-pressed') === 'true');
    const space = async () => {
      await win.evaluate(() => document.activeElement?.blur());
      await win.keyboard.press('Space');
    };

    // A short drum & bass track.
    await pick('Start from', 'style');
    await pick('Music', 'Drum & bass');
    await pick('Style', 'dnb-twostep');
    t.check('Auto picks the drum & bass form for a drum & bass style', (await win.textContent('.trackbuilder select[aria-label="Form"] option:checked'))?.includes('Drum & bass'));
    await pick('Length', 'short');
    const planRows = await win.locator('.trackbuilder .plan-row').count();
    t.check('the section plan lists the form\'s sections', planRows === 7, `${planRows} sections`);
    const before = await state();
    await win.click('.trackbuilder .build-track');
    await sleep(300);
    let s = await state();
    t.check('building writes the song', s.song.length > 7 && s.song.every((e) => e.bars % 4 === 0), `${s.song.length} entries`);
    t.check('the tempo follows the style (174 BPM)', s.bpm === 174, s.bpm);
    t.check('the song is set to stop after the outro (no loop)', s.loop === false);
    t.check('song mode is switched on', await songPressed());
    t.check('your own patterns stay', before.patterns.every((x) => s.patterns.some((y) => y.id === x.id)));
    const tl = await timeline();
    t.check('the timeline shows the sections in order', tl.join(' ') === 'Intro8 Build4 Drop16 Breakdown8 Build4 Drop16 Outro8', tl.join(' '));
    t.check('the song bar colours the built blocks by section', (await win.locator('.song-entry.kind-chorus').count()) > 0);
    const names = s.song.map((e) => e.name);
    t.check('drops start with a crash pattern and sections end with fills', names.includes('Drop in') && names.filter((n) => / fill/.test(n)).length >= 4 && names[names.length - 1] === 'Outro end', names.join(', '));
    t.check('the total is 64 bars, about 1:28 at 174 BPM', (await win.textContent('.trackbuilder [aria-label="Track"] .about'))?.includes('64 bars · 1:28'), await win.textContent('.trackbuilder [aria-label="Track"] .about'));

    // Clicking a section shows its pattern in the grid.
    await win.click('.trackbuilder .tl-section[data-section="3"]');
    await sleep(150);
    t.check('clicking a section shows its pattern', (await win.textContent('.pattern-btn.current')) === 'Breakdown', await win.textContent('.pattern-btn.current'));
    t.check('the breakdown has no kick or snare on the grid', await win.evaluate(() => [...Array(64).keys()].every((i) => !document.querySelector(`[data-cell="t1:${i % 16}"]`)?.classList.contains('on') && !document.querySelector(`[data-cell="t3:${i % 16}"]`)?.classList.contains('on'))));

    // Export the whole track as one WAV.
    const wavPath = join(profile, 'track.wav');
    await stubDialogs(app, { savePath: wavPath });
    await win.keyboard.press('Control+e');
    await win.check('input[name=export-what] >> nth=1');
    await win.click('.modal button.primary');
    const expected = (64 * 240) / 174;
    await win.waitForFunction((sec) => Math.abs((window.__lastExportInfo?.musicalSeconds ?? 0) - sec) < 0.01, expected, { timeout: 120000 }).catch(() => {});
    const info = await win.evaluate(() => window.__lastExportInfo);
    t.check('the whole track exports as one file of the right length', info && Math.abs(info.musicalSeconds - expected) < 0.01 && info.events > 500, info && `${info.musicalSeconds.toFixed(2)} s, ${info.events} hits`);
    t.check('track WAV written', existsSync(wavPath));

    // A new take of the drops only.
    const verseBefore = s.patterns.filter((x) => /^Intro|^Breakdown|^Outro/.test(x.name));
    const dropBefore = s.patterns.find((x) => x.name === 'Drop in');
    await win.click('.trackbuilder .retake:has-text("Drop")');
    await sleep(200);
    let s2 = await state();
    t.check('a new take changes the drops', s2.patterns.find((x) => x.id === dropBefore.id)?.lanes !== dropBefore.lanes);
    t.check('and leaves the other sections and the song as they were', verseBefore.every((x) => s2.patterns.find((y) => y.id === x.id)?.lanes === x.lanes) && JSON.stringify(s2.song) === JSON.stringify(s.song));
    await win.keyboard.press('Control+z');
    await sleep(200);
    s2 = await state();
    t.check('undo brings the old drops back', s2.patterns.find((x) => x.id === dropBefore.id)?.lanes === dropBefore.lanes);

    // Change the plan: a song form, remove the break, make the first chorus longer.
    await pick('Form', 'short');
    let rows = await win.locator('.trackbuilder .plan-row').count();
    await win.click('[aria-label="Remove section 4"]');
    await pick('Bars for section 3', '12');
    rows = await win.locator('.trackbuilder .plan-row').count();
    t.check('sections can be removed and their length changed', rows === 5, `${rows} sections`);
    const count = s.patterns.length;
    await win.click('.trackbuilder .build-track');
    await sleep(300);
    s = await state();
    const tl2 = await timeline();
    t.check('building again uses the changed plan', tl2.join(' ') === 'Intro4 Verse4 Chorus12 Chorus4 Outro4' || tl2.join(' ') === 'Intro4 Verse4 Chorus16 Outro4', tl2.join(' '));
    t.check('building again replaces the track built before, not adding to it', s.patterns.filter((x) => /^(Drop|Breakdown|Build)/.test(x.name)).length === 0 && s.patterns.length < count, `${count} -> ${s.patterns.length} patterns`);
    t.check('your own patterns are still there', before.patterns.every((x) => s.patterns.some((y) => y.id === x.id)));
    await win.keyboard.press('Control+z');
    await sleep(200);
    t.check('undo goes back to the drum & bass track in one step', (await timeline()).join(' ').startsWith('Intro8 Build4 Drop16'), (await timeline()).join(' '));

    // Save and reopen.
    const work = newProfile();
    await stubDialogs(app, { savePath: join(work, 'Track.badaboom'), openPath: join(work, 'Track', 'Track.badaboom') });
    await win.keyboard.press('Control+s');
    await win.waitForFunction(() => !document.querySelector('.statusbar')?.textContent?.includes('unsaved'), null, { timeout: 10000 }).catch(() => {});
    const saved = await state();
    const savedTl = await timeline();
    await win.keyboard.press('Control+o');
    await win.waitForTimeout(1500);
    const reopened = await state();
    t.check('the track survives save and reopen', JSON.stringify(reopened.song) === JSON.stringify(saved.song) && JSON.stringify(await timeline()) === JSON.stringify(savedTl), (await timeline()).join(' '));

    // A whole track, played from start to finish.
    await openTool(win, 'Whole track');
    await pick('Form', 'auto');
    await pick('Length', 'normal');
    await win.click('.trackbuilder .build-track');
    await sleep(300);
    const full = await timeline();
    t.check('a normal drum & bass track: intro, build, drop, breakdown, build, drop, outro', full.join(' ') === 'Intro16 Build8 Drop32 Breakdown16 Build8 Drop32 Outro16', full.join(' '));
    const songEntries = (await state()).song.length;
    await win.click('.trackbuilder .play-track');
    const started = await win.waitForFunction(() => window.__engine.isPlaying, null, { timeout: 10000 }).then(() => true, () => false);
    const fromTop = started && (await win.waitForFunction(() => window.__engine.songState()?.index === 0 && window.__engine.songState()?.pass === 0, null, { timeout: 5000 }).then(() => true, () => false));
    t.check('Play track starts the song from the top', fromTop, JSON.stringify(await win.evaluate(() => window.__engine.songState())));
    const t0 = Date.now();
    const clock = [];
    const quiet = [];
    const heard = [];
    let lastLoud = Date.now();
    let finished = false;
    while (Date.now() - t0 < SECONDS_LIMIT * 1000) {
      const m = await win.evaluate(() => {
        const meters = window.__engine.readMeters(16);
        const el = document.querySelector('.trackbuilder .tl-section.playing');
        return { peak: Math.max(meters.left, meters.right), ct: window.__engine.ac.currentTime, playing: window.__engine.isPlaying, song: window.__engine.songState(), section: el ? Number(el.dataset.section) : -1 };
      });
      if (!m.playing) {
        finished = true;
        break;
      }
      clock.push([Date.now() / 1000, m.ct]);
      if (m.section >= 0 && heard[heard.length - 1] !== m.section) heard.push(m.section);
      if (m.peak > 0.02) lastLoud = Date.now();
      else if (Date.now() - lastLoud > 3000 && !m.song?.finished && m.song?.index !== -1) quiet.push(Math.round((Date.now() - t0) / 1000));
      await sleep(250);
    }
    const took = (Date.now() - t0) / 1000;
    if (!finished) await space();
    const length = (128 * 240) / 174;
    t.check('the whole track plays to the end and stops by itself', finished && took > length && took < length + 15, `${took.toFixed(0)} s for ${length.toFixed(0)} s of music`);
    t.check('every section is heard, in order', heard.join(',') === '0,1,2,3,4,5,6', heard.join(','));
    t.check('the sound never dropped out for more than 3 s', quiet.length === 0, quiet.length ? `quiet at ${[...new Set(quiet)].slice(0, 8).join(', ')} s` : 'never');
    const a = clock[Math.max(0, clock.length - 40)] ?? [0, 0];
    const b = clock[clock.length - 1] ?? [1, 0];
    const speed = (b[1] - a[1]) / (b[0] - a[0]);
    t.check('the audio keeps up with real time to the end', speed > 0.9, `${speed.toFixed(2)}× real time over the last ${(b[0] - a[0]).toFixed(0)} s`);
    t.check(`the track had ${songEntries} song blocks`, songEntries >= 20, songEntries);
    t.check('no errors in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
  } finally {
    await closeApp(app, win).catch(() => app.close());
  }
}

await runStandalone(import.meta.url, 'Whole track', run);

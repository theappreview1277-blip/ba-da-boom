// Song mode through the real UI: build an arrangement, play it (the grid
// follows), loop, leave the song with a pattern key, stop at the end without
// loop, export the whole song, edit the order, and save/reopen.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { closeApp, launchApp, newProfile, runStandalone, stubDialogs } from './lib.mjs';

export async function run(t) {
  const { app, win, profile, pageErrors } = await launchApp();
  try {
    const ids = await win.evaluate(() => window.__engine['project'].patterns.map((p) => p.id));
    const song = () => win.evaluate(() => ({ song: window.__engine['project'].song, loop: window.__engine['project'].songLoop }));
    const songPressed = () => win.evaluate(() => document.querySelector('.songbar .mode button:last-child').getAttribute('aria-pressed') === 'true');

    // Pattern B gets one snare on beat 2 so it sounds different from A.
    await win.keyboard.press('2');
    await win.click('[data-cell="t3:4"]');
    // Song: A (2 bars), B (1 bar).
    await win.keyboard.press('1');
    await win.click('.songbar .add');
    await win.selectOption('.song-entry >> nth=0 >> select', '2');
    await win.keyboard.press('2');
    await win.click('.songbar .add');
    let s = await song();
    t.check('adding patterns builds the song in order', s.song.map((e) => e.patternId).join() === [ids[0], ids[1]].join() && s.song[0].bars === 2 && s.song[1].bars === 1, s.song.map((e) => `${e.bars}`).join('+'));
    t.check('the song bar shows the total length', (await win.textContent('.songbar'))?.includes('3 bars · 0:06'));

    // Play the song: A A B, then it loops.
    await win.keyboard.press('g');
    t.check('G switches to song mode', await songPressed());
    await win.keyboard.press('Space');
    await win.waitForFunction(() => window.__engine.audibleCycle() > 2.15, null, { timeout: 15000 });
    let st = await win.evaluate(() => ({ audible: window.__engine.audiblePatternId, song: window.__engine.songState(), current: window.__engine['project'].currentPatternId }));
    t.check('after two bars of A, B plays', st.audible === ids[1] && st.song?.index === 1, st.song);
    t.check('the playing song entry is highlighted', await win.evaluate(() => document.querySelector('.song-entry.playing')?.dataset.songIndex === '1'));
    await win.waitForTimeout(100);
    st.current = await win.evaluate(() => document.querySelector('.pattern-btn.current')?.textContent);
    t.check('the grid follows the song (pattern B shown)', st.current === 'B', st.current);
    await win.waitForFunction(() => window.__engine.audibleCycle() > 3.15, null, { timeout: 15000 });
    st = await win.evaluate(() => ({ audible: window.__engine.audiblePatternId, song: window.__engine.songState() }));
    t.check('with loop on, the song starts again with A', st.audible === ids[0] && st.song?.index === 0 && st.song?.pass === 1, st.song);

    // A pattern key leaves the song at the next bar.
    await win.keyboard.press('2');
    const q = await win.evaluate(() => window.__engine.queued);
    t.check('pressing 2 during the song queues B at the next bar and leaves song mode', q?.patternId === ids[1] && Number.isInteger(q.atCycle) && !(await songPressed()), q);
    await win.waitForFunction((at) => window.__engine.audibleCycle() > at + 1.2, q.atCycle, { timeout: 15000 });
    st = await win.evaluate(() => ({ audible: window.__engine.audiblePatternId, song: window.__engine.songState(), playing: window.__engine.isPlaying }));
    t.check('B keeps looping after the song (no song position)', st.audible === ids[1] && st.song === null && st.playing, st);
    await win.keyboard.press('Space');

    // Without loop, the song stops by itself at the end.
    await win.uncheck('.songbar input[type=checkbox]');
    await win.keyboard.press('g');
    t.check('shortcuts still work after clicking a checkbox (G: song mode on)', await songPressed());
    await win.keyboard.press('Space');
    await win.waitForTimeout(300);
    const started = await win.evaluate(() => window.__engine.isPlaying);
    let lastCycle = 0;
    const stopped =
      started &&
      (await win
        .waitForFunction(() => (window.__lastCycle = window.__engine.audibleCycle() ?? window.__lastCycle) !== null && !window.__engine.isPlaying, null, { timeout: 12000, polling: 50 })
        .then(() => true, () => false));
    lastCycle = await win.evaluate(() => window.__lastCycle);
    t.check('with loop off, the song plays to the end, rings out for 2 s and stops by itself', started && stopped && lastCycle >= 3.9 && lastCycle < 4.3, `started ${started}, last cycle heard ${lastCycle?.toFixed?.(2)}`);

    // Export the whole song.
    const wavPath = join(profile, 'song.wav');
    await stubDialogs(app, { savePath: wavPath });
    await win.keyboard.press('Control+e');
    await win.check('input[name=export-what] >> nth=1');
    t.check('export dialog offers the song', (await win.textContent('.modal h2, .modal [role=heading], .modal'))?.includes('Export song'));
    await win.click('.modal button.primary');
    await win.waitForFunction(() => window.__lastExportInfo?.musicalSeconds === 6, null, { timeout: 60000 }).catch(() => {});
    const info = await win.evaluate(() => window.__lastExportInfo);
    t.check('song export is 3 bars long (6 s at 120 BPM) plus tail', info?.musicalSeconds === 6 && info.seconds > 6, info && `${info.musicalSeconds} s + tail = ${info.seconds.toFixed(2)} s`);
    t.check('song export has every hit: 2 bars of A (14 each) + B (1)', info?.events === 29, info?.events);
    t.check('song WAV written', existsSync(wavPath));

    // Edit the order, remove, undo.
    await win.click('[aria-label="Move entry 2 earlier"]');
    s = await song();
    t.check('moving an entry reorders the song', s.song.map((e) => e.patternId).join() === [ids[1], ids[0]].join());
    await win.click('[aria-label="Remove entry 1"]');
    s = await song();
    t.check('removing an entry', s.song.length === 1 && s.song[0].patternId === ids[0]);
    await win.keyboard.press('Control+z');
    s = await song();
    t.check('undo brings it back', s.song.length === 2);

    // Saved in the project file.
    const work = newProfile();
    await stubDialogs(app, { savePath: join(work, 'Song.badaboom'), openPath: join(work, 'Song', 'Song.badaboom') });
    await win.keyboard.press('Control+s');
    await win.waitForFunction(() => !document.querySelector('.statusbar')?.textContent?.includes('unsaved'), null, { timeout: 10000 }).catch(() => {});
    const before = await song();
    await win.keyboard.press('Control+o');
    await win.waitForTimeout(1500);
    const after = await song();
    t.check('song and loop setting survive save and reopen', JSON.stringify(after) === JSON.stringify(before), after.song.map((e) => e.bars).join('+'));
    t.check('no errors in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
  } finally {
    await closeApp(app, win).catch(() => app.close());
  }
}

await runStandalone(import.meta.url, 'Song mode', run);

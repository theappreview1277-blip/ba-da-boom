// Beat intelligence through the real UI: beats in a style (drum & bass family),
// style detection, completing a started beat, fills (queued while playing and
// in place), humanise, undo, and several minutes of playback while beats,
// fills and humanise are changed the way a person would. Sound must never
// drop out and the audio clock must keep up with real time.
import { closeApp, launchApp, runStandalone } from './lib.mjs';
import { openTool } from './lib.mjs';

const SECONDS = Number(process.env.BDB_SMARTPLAY_SECONDS ?? 180);

export async function run(t) {
  const { app, win, pageErrors } = await launchApp();
  win.setDefaultTimeout(15000);
  try {
    await openTool(win, 'Beat intelligence');
    const cur = () =>
      win.evaluate(() => {
        const p = window.__engine['project'];
        const pt = p.patterns.find((x) => x.id === p.currentPatternId);
        const grid = (id) => pt.lanes[id].steps.slice(0, pt.lanes[id].length).map((s) => (s.on ? 'x' : '.')).join('');
        return { bpm: p.bpm, swing: p.swing, name: pt.name, id: pt.id, count: p.patterns.length, kick: grid('t1'), snare: grid('t3'), hat: grid('t6'), ohat: grid('t7'), lanes: pt.lanes };
      });
    const pick = (label, value) => win.selectOption(`.smart select[aria-label="${label}"]`, value);
    const button = (text) => win.click(`.smart button:has-text("${text}")`);
    const sleep = (ms) => win.waitForTimeout(ms);
    // Space plays and stops, unless a control has focus (sliders keep their keys), like for a person.
    const space = async () => {
      await win.evaluate(() => document.activeElement?.blur());
      await win.keyboard.press('Space');
    };

    // Drum & bass two-step.
    await pick('Music', 'Drum & bass');
    await pick('Pattern', 'dnb-twostep');
    t.check('the pattern list shows the drum & bass family', (await win.locator('.smart select[aria-label="Pattern"] option').allTextContents()).join(', ').includes('Halftime'));
    await win.locator('.smart .slider:has(label:text-is("Complexity")) input').fill('0');
    await button('New beat');
    await sleep(200);
    let p = await cur();
    t.check('two-step: kick on 1 and before 3', p.kick === 'x.........x.....', p.kick);
    t.check('two-step: snare on 2 and 4', p.snare === '....x.......x...', p.snare);
    t.check('the tempo follows the style (174 BPM)', p.bpm === 174, p.bpm);
    t.check('the grid shows the beat', await win.evaluate(() => document.querySelector('[data-cell="t1:10"]').classList.contains('on')));
    t.check('"Sounds like" recognises it', (await win.textContent('.smart .detect'))?.includes('Drum & bass'), await win.textContent('.smart .detect'));

    await pick('Pattern', 'dnb-halftime');
    await button('New beat');
    await sleep(200);
    p = await cur();
    t.check('halftime: one snare per bar, on beat 3', p.snare.split('').every((c, i) => (c === 'x') === (i % 16 === 8)), p.snare);
    await pick('Pattern', 'dnb-amen');
    await button('New beat');
    await sleep(200);
    p = await cur();
    t.check('Amen-style break: four bars', p.snare.length === 64, p.snare.length);

    await win.keyboard.press('Control+z');
    await sleep(200);
    p = await cur();
    t.check('undo goes back to the previous beat in one step', p.snare.length < 64 && p.snare.split('').every((c, i) => (c === 'x') === (i % 16 === 8)), p.snare);
    // The random dice (the old "shuffle") is gone: named beats live in the beat library.
    t.check('the style generator has no dice button any more', (await win.locator('.smart button:has-text("🎲")').count()) === 0);
    await win.fill('#beat-seed', '2');
    await button('New beat');
    await sleep(200);
    const seeded = (await cur()).snare;
    t.check('a typed seed still writes the picked pattern (Amen-style, four bars)', seeded.length === 64, seeded.length);

    // Complete my beat: start a beat on the empty pattern B by hand.
    await win.click('.pattern-btn:text-is("B")');
    await sleep(200);
    for (const c of ['t1:0', 't1:10', 't3:4', 't3:12']) await win.click(`[data-cell="${c}"]`);
    await sleep(300);
    t.check('a hand-typed two-step reads as drum & bass', (await win.textContent('.smart .detect'))?.includes('Drum & bass'), await win.textContent('.smart .detect'));
    await pick('Music', 'Rock & metal');
    await pick('Pattern', 'rock');
    if (await win.locator('.smart .detect button:has-text("Use")').count()) await win.click('.smart .detect button:has-text("Use")');
    await sleep(100);
    const chosen = await win.inputValue('.smart select[aria-label="Pattern"]');
    t.check('"Use" picks the recognised pattern', chosen.startsWith('dnb-'), chosen);
    await button('Complete my beat');
    await sleep(200);
    p = await cur();
    t.check('Complete keeps what was typed', p.kick === 'x.........x.....' && p.snare === '....x.......x...', `${p.kick} ${p.snare}`);
    t.check('Complete adds the hats', p.hat.includes('x'), p.hat);

    // Fill as a new pattern while playing: queued, then heard.
    await space();
    await sleep(400);
    const countBefore = p.count;
    await pick('Fill', 'roll');
    await win.locator('.smart .slider:has(label:text-is("Intensity")) input').fill('1');
    await button('Add fill pattern');
    await sleep(200);
    p = await cur();
    t.check('Add fill pattern adds "B fill" after B', p.count === countBefore + 1 && p.name === 'B fill', p.name);
    t.check('the fill rolls the snare at the end of the bar', p.snare.slice(12) === 'xxxx', p.snare);
    t.check('the fill has ratchets at full intensity', p.lanes.t3.steps.slice(12, 16).some((s) => s.ratchet > 1));
    t.check('while playing, the fill pattern is queued for the next bar', await win.evaluate((id) => window.__engine.queued?.patternId === id || window.__engine.audiblePatternId === id, p.id));
    await win.waitForFunction((id) => window.__engine.audiblePatternId === id, p.id, { timeout: 6000 }).catch(() => {});
    t.check('the fill becomes audible without stopping', await win.evaluate((id) => window.__engine.audiblePatternId === id && window.__engine.isPlaying, p.id));
    await space();

    // Fill in place.
    await win.click('.pattern-btn:text-is("B")');
    await sleep(200);
    await pick('Fill', 'break');
    await button('Fill this pattern');
    await sleep(200);
    p = await cur();
    t.check('Drop out writes into this pattern: silence then pickup snares', p.kick.slice(12) === '....' && p.hat.slice(12) === '....' && p.snare.slice(12).endsWith('x'), `${p.kick.slice(12)} ${p.hat.slice(12)} ${p.snare.slice(12)}`);

    // Humanise.
    await pick('Feel', 'laidback');
    await button('Humanise');
    await sleep(200);
    p = await cur();
    const snareMicro = p.lanes.t3.steps.filter((s) => s.on).map((s) => s.micro);
    t.check('Humanise (laid back) puts the snare behind the beat', snareMicro.length > 0 && snareMicro.reduce((a, b) => a + b, 0) / snareMicro.length > 0.03, snareMicro.join(' '));
    t.check('no errors in the page so far', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');

    // Several minutes of playback, changing beats like a person would.
    const plan = [
      ['Drum & bass', 'dnb-twostep'],
      ['Trap & drill', 'trap'],
      ['Drum & bass', 'dnb-amen'],
      ['Jazz & blues', 'jazz-swing'],
      ['House', 'house-classic'],
      ['Drum & bass', 'dnb-soulpride'],
      ['Hip-hop', 'hiphop-boombap'],
      ['Latin', 'samba'],
      ['Reggae & dancehall', 'reggaeton'],
      ['Drum & bass', 'dnb-doublekick'],
      ['Rock & metal', 'metal'],
      ['African', 'afrobeats'],
    ];
    await win.click('.pattern-btn:text-is("A")');
    await win.locator('.smart .slider:has(label:text-is("Complexity")) input').fill('1');
    await space();
    const t0 = Date.now();
    const clock = [];
    const quiet = [];
    let lastLoud = Date.now();
    let step = 0;
    let nextChange = 0;
    while (Date.now() - t0 < SECONDS * 1000) {
      const now = Date.now() - t0;
      if (now >= nextChange) {
        const [genre, id] = plan[step % plan.length];
        await pick('Music', genre);
        await pick('Pattern', id);
        await button('New beat');
        if (step % 3 === 1) {
          await pick('Fill', 'auto');
          await button('Fill this pattern');
        }
        if (step % 4 === 2) await button('Humanise');
        step++;
        nextChange = now + 15000;
      }
      const s = await win.evaluate(() => {
        const m = window.__engine.readMeters(16);
        return { peak: Math.max(m.left, m.right), ct: window.__engine.ac.currentTime, playing: window.__engine.isPlaying };
      });
      clock.push([Date.now() / 1000, s.ct]);
      if (s.peak > 0.02) lastLoud = Date.now();
      else if (Date.now() - lastLoud > 3000) quiet.push(Math.round((Date.now() - t0) / 1000));
      await sleep(250);
    }
    const playing = await win.evaluate(() => window.__engine.isPlaying);
    await space();
    const a = clock[Math.max(0, clock.length - 40)];
    const b = clock[clock.length - 1];
    const speed = (b[1] - a[1]) / (b[0] - a[0]);
    t.check(`${SECONDS} s of playback through ${step} beat changes: still playing at the end`, playing && step >= Math.floor(SECONDS / 15), `${step} changes`);
    t.check('the sound never dropped out for more than 3 s', quiet.length === 0, quiet.length ? `quiet at ${[...new Set(quiet)].slice(0, 8).join(', ')} s` : 'never');
    t.check('the audio keeps up with real time to the end', speed > 0.9, `${speed.toFixed(2)}× real time over the last ${(b[0] - a[0]).toFixed(0)} s`);
    t.check('no errors in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
  } finally {
    await closeApp(app, win).catch(() => app.close());
  }
}

await runStandalone(import.meta.url, 'Beat intelligence', run);

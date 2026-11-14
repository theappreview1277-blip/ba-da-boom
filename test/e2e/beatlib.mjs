// The named beat library through the real UI: finding a beat by name, loading
// a variant (always the same beat), stepping through variants with the arrows,
// tempo, undo, adding every variant as patterns while playing, and several
// minutes of playback while beats and variants change the way a person would.
// Sound must never drop out and the audio clock must keep up with real time.
import { closeApp, launchApp, runStandalone } from './lib.mjs';
import { openTool } from './lib.mjs';

const SECONDS = Number(process.env.BDB_BEATLIB_SECONDS ?? 180);

// The Amen break as the library writes it (kick and snare, four bars).
const AMEN_KICK = 'x.x.......xx....x.x.......xx....x.x.......x.......xx......x.....';
const AMEN_SNARE = '....x..x.x..x..x....x..x.x..x..x....x..x.x....x..x..x..x.x....x.';

export async function run(t) {
  const { app, win, pageErrors } = await launchApp();
  win.setDefaultTimeout(15000);
  try {
    await openTool(win, 'Beat library');
    const cur = () =>
      win.evaluate(() => {
        const p = window.__engine['project'];
        const pt = p.patterns.find((x) => x.id === p.currentPatternId);
        const grid = (id) => pt.lanes[id].steps.slice(0, pt.lanes[id].length).map((s) => (s.on ? 'x' : '.')).join('');
        return { bpm: p.bpm, swing: p.swing, name: pt.name, id: pt.id, count: p.patterns.length, names: p.patterns.map((x) => x.name), kick: grid('t1'), snare: grid('t3'), hat: grid('t6'), ride: grid('t15'), lanes: pt.lanes };
      });
    const lib = '.beatlib';
    const pick = (label, value) => win.selectOption(`${lib} select[aria-label="${label}"]`, value);
    const button = (text) => win.click(`${lib} button:has-text("${text}")`);
    const next = () => win.click(`${lib} button[aria-label="Next variant"]`);
    const prev = () => win.click(`${lib} button[aria-label="Previous variant"]`);
    const sleep = (ms) => win.waitForTimeout(ms);
    const space = async () => {
      await win.evaluate(() => document.activeElement?.blur());
      await win.keyboard.press('Space');
    };

    t.check('the beat library is on screen', await win.isVisible(lib));
    const head = await win.textContent(`${lib} h3`);
    const [, beats, variants] = head.match(/(\d+) named beats, (\d+) variants/) ?? [];
    t.check('it lists at least 70 named beats and 220 variants', Number(beats) >= 70 && Number(variants) >= 220, head);

    // Find the Amen by typing its name.
    await win.fill(`${lib} input[aria-label="Find a beat"]`, 'amen');
    await sleep(100);
    const found = await win.locator(`${lib} select[aria-label="Beat"] option`).allTextContents();
    t.check('typing "amen" finds the Amen break', found.includes('Amen break'), found.join(', '));
    await pick('Beat', 'amen');
    const vars = await win.locator(`${lib} select[aria-label="Variant"] option`).allTextContents();
    t.check('the Amen has named variants', vars.length >= 5 && vars[0].includes('Full break'), vars.join(' | '));
    t.check('the preview shows its kick, snare, ride and crash', (await win.locator(`${lib} .beatlib-row`).count()) === 4);
    await pick('Variant', '0');
    await button('Load beat');
    await sleep(200);
    let p = await cur();
    t.check('Load writes the Amen kick exactly', p.kick === AMEN_KICK, p.kick);
    t.check('and the Amen snare, ghost notes included', p.snare === AMEN_SNARE, p.snare);
    t.check('the tempo follows the beat (136 BPM)', p.bpm === 136, p.bpm);
    t.check('the grid shows it', await win.evaluate(() => document.querySelector('[data-cell="t1:2"]').classList.contains('on')));
    const ghost = p.lanes.t3.steps[7].velocity;
    t.check('ghost notes are quiet and backbeats loud', ghost < 0.5 && p.lanes.t3.steps[4].velocity > 0.9, `${ghost} / ${p.lanes.t3.steps[4].velocity}`);
    const first = p.lanes;
    await button('Load beat');
    await sleep(150);
    t.check('loading again writes exactly the same beat (nothing random)', JSON.stringify((await cur()).lanes) === JSON.stringify(first));

    // The arrows step through the named variants and write each one.
    await next();
    await sleep(150);
    p = await cur();
    t.check('▶ moves to variant 2 and writes it (one bar)', (await win.inputValue(`${lib} select[aria-label="Variant"]`)) === '1' && p.kick === 'x.x.......xx....', p.kick);
    await prev();
    await prev();
    await sleep(150);
    p = await cur();
    const last = String(vars.length - 1);
    t.check('◀ before the first variant comes round to the last', (await win.inputValue(`${lib} select[aria-label="Variant"]`)) === last && p.bpm === 170, `${await win.inputValue(`${lib} select[aria-label="Variant"]`)} ${p.bpm}`);

    await win.keyboard.press('Control+z');
    await sleep(150);
    t.check('undo goes back one variant (to the full break)', (await cur()).kick === AMEN_KICK);

    // Browse by kind: Soul Pride.
    await win.fill(`${lib} input[aria-label="Find a beat"]`, '');
    await pick('Kind', 'Breaks');
    await pick('Beat', 'soul-pride');
    await button('Load beat');
    await sleep(150);
    p = await cur();
    t.check('Soul Pride loads with its tempo (106 BPM) and 16th hats', p.bpm === 106 && p.hat.startsWith('xxxx'), `${p.bpm} ${p.hat}`);
    await pick('Variant', '2');
    await button('Load beat');
    await sleep(150);
    t.check('its DnB variant is at 174 BPM', (await cur()).bpm === 174);

    // Tempo left alone.
    await win.uncheck(`${lib} .check input`);
    await pick('Kind', 'Funk & soul');
    await pick('Beat', 'purdie');
    await button('Load beat');
    await sleep(150);
    p = await cur();
    t.check('with "Use its tempo" off, the tempo stays', p.bpm === 174, p.bpm);
    t.check('the Purdie shuffle writes triplet timing', Math.abs(p.lanes.t6.steps[3].micro + 0.33) < 0.01, p.lanes.t6.steps[3].micro);
    await win.check(`${lib} .check input`);

    // The second batch of beats: a Jazz kind, and world rhythms on toms and rim.
    const kindsNow = await win.locator(`${lib} select[aria-label="Kind"] option`).evaluateAll((os) => os.map((o) => o.value));
    t.check('there is a Jazz kind', kindsNow.includes('Jazz'), kindsNow.join(', '));
    await pick('Kind', 'Jazz');
    await pick('Beat', 'jazz-swing');
    await button('Load beat');
    await sleep(150);
    p = await cur();
    t.check('Jazz swing writes the spang-a-lang ride at 140 BPM', p.ride === 'x...x..xx...x..x' && p.bpm === 140, `${p.ride} ${p.bpm}`);
    t.check('its skip notes sit on the triplet grid', Math.abs(p.lanes.t15.steps[7].micro + 0.33) < 0.01, p.lanes.t15.steps[7].micro);
    await win.fill(`${lib} input[aria-label="Find a beat"]`, 'baladi');
    await sleep(100);
    const mid = await win.locator(`${lib} select[aria-label="Beat"] option`).allTextContents();
    t.check('typing "baladi" finds the Middle Eastern rhythms', mid.includes('Middle Eastern rhythms'), mid.join(', '));
    await pick('Beat', 'maqsum');
    const midVars = await win.locator(`${lib} select[aria-label="Variant"] option`).allTextContents();
    t.check('they include maqsum, baladi, saidi and malfuf', ['Maqsum', 'Baladi', 'Saidi', 'Malfuf'].every((n) => midVars.some((v) => v.replace(/^\d+\.\s*/, '').startsWith(n))), midVars.join(' | '));
    await pick('Variant', '1');
    await button('Load beat');
    await sleep(150);
    p = await cur();
    const tomRim = Object.values(p.lanes).map((l) => l.steps.slice(0, l.length).map((s) => (s.on ? 'x' : '.')).join(''));
    t.check('Baladi writes doum (D D . T D . T .) and tek', tomRim.includes('x.x.....x.......') && tomRim.includes('......x.....x...'), tomRim.filter((g) => g.includes('x')).join(' / '));
    await win.fill(`${lib} input[aria-label="Find a beat"]`, '');


    // Add every variant as patterns, while playing.
    await win.fill(`${lib} input[aria-label="Find a beat"]`, 'funky drummer');
    await pick('Beat', 'funky-drummer');
    const fdVars = await win.locator(`${lib} select[aria-label="Variant"] option`).count();
    const before = (await cur()).count;
    await space();
    await sleep(500);
    await button(`Add all ${fdVars} as patterns`);
    await sleep(200);
    p = await cur();
    t.check(`"Add all" adds ${fdVars} patterns named FunkyDrm 1..${fdVars}`, p.count === before + fdVars && p.names.includes('FunkyDrm 1') && p.names.includes(`FunkyDrm ${fdVars}`), p.names.join(', '));
    t.check('the first one is current', p.name === 'FunkyDrm 1', p.name);
    t.check('while playing, it is queued for the next bar', await win.evaluate((id) => window.__engine.queued?.patternId === id || window.__engine.audiblePatternId === id, p.id));
    await win.waitForFunction((id) => window.__engine.audiblePatternId === id, p.id, { timeout: 8000 }).catch(() => {});
    t.check('and becomes audible without stopping', await win.evaluate((id) => window.__engine.audiblePatternId === id && window.__engine.isPlaying, p.id));
    await space();
    t.check('no errors in the page so far', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');

    // Several minutes of playback, changing beats and variants like a person would.
    const plan = ['amen', 'jazz-swing', 'funky-drummer', 'soca', 'apache', 'gospel', 'think', 'maqsum', 'soul-pride', 'hardstyle', 'boom-bap', 'purdie', 'trap', 'two-step', 'metal', 'dembow', 'house', 'jungle', 'levee', 'clave'];
    await win.fill(`${lib} input[aria-label="Find a beat"]`, '');
    await space();
    const t0 = Date.now();
    const clock = [];
    const quiet = [];
    let lastLoud = Date.now();
    let changes = 0;
    let nextChange = 0;
    while (Date.now() - t0 < SECONDS * 1000) {
      const now = Date.now() - t0;
      if (now >= nextChange) {
        if (changes % 3 === 0) {
          const id = plan[(changes / 3) % plan.length];
          // Pick the kind that lists this beat, like a person browsing.
          const kinds = await win.locator(`${lib} select[aria-label="Kind"] option`).evaluateAll((os) => os.map((o) => o.value));
          for (const k of kinds) {
            await pick('Kind', k);
            if (await win.locator(`${lib} select[aria-label="Beat"] option[value="${id}"]`).count()) break;
          }
          await pick('Beat', id);
          await button('Load beat');
        } else {
          await next();
        }
        changes++;
        nextChange = now + 8000;
      }
      const s = await win.evaluate(() => {
        const m = window.__engine.readMeters(16);
        return { peak: Math.max(m.left, m.right), ct: window.__engine.ac.currentTime };
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
    t.check(`${SECONDS} s of playback through ${changes} beat and variant changes: still playing at the end`, playing && changes >= Math.floor(SECONDS / 8), `${changes} changes`);
    t.check('the sound never dropped out for more than 3 s', quiet.length === 0, quiet.length ? `quiet at ${[...new Set(quiet)].slice(0, 8).join(', ')} s` : 'never');
    t.check('the audio keeps up with real time to the end', speed > 0.9, `${speed.toFixed(2)}× real time over the last ${(b[0] - a[0]).toFixed(0)} s`);
    t.check('no errors in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
  } finally {
    await closeApp(app, win).catch(() => app.close());
  }
}

await runStandalone(import.meta.url, 'Beat library', run);

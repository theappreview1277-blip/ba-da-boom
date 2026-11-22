// Items from the app review, through the real UI: tap tempo (button and T),
// the mouse wheel on the tempo box, the keyboard shortcuts list (? and the
// status bar button) replacing the hint texts, the step-lane and status bar
// left clean, and the screen resting (no meter work) while stopped and quiet.
import { closeApp, launchApp, runStandalone } from './lib.mjs';

export async function run(t) {
  const { app, win, pageErrors } = await launchApp();
  win.setDefaultTimeout(15000);
  const sleep = (ms) => win.waitForTimeout(ms);
  const bpm = () => win.evaluate(() => window.__engine['project'].bpm);
  const blur = () => win.evaluate(() => document.activeElement?.blur());
  try {
    // 1. Tap tempo with the button: four taps half a second apart is about 120 BPM.
    // The moments the app saw each tap are recorded too, so the tempo can be checked
    // exactly however long the test's own clicks take to arrive.
    await win.evaluate(() => {
      window.__taps = [];
      window.addEventListener('click', (e) => e.target.closest?.('.tap') && window.__taps.push(performance.now()), true);
      window.addEventListener('keydown', (e) => e.key === 't' && !e.repeat && window.__taps.push(performance.now()), true);
    });
    const expected = () =>
      win.evaluate(() => {
        const t = window.__taps.slice(-5);
        return Math.round((60000 / ((t[t.length - 1] - t[0]) / (t.length - 1))) * 10) / 10;
      });
    const start = await bpm();
    for (let i = 0; i < 4; i++) {
      await win.click('.transport .tap');
      if (i < 3) await sleep(500);
    }
    const tapped = await bpm();
    const want = await expected();
    t.check('taps on Tap set the tempo they were tapped at', Math.abs(tapped - want) <= 0.2 && Math.abs(tapped - 120) <= 20, `${tapped} BPM (taps at ${want})`);
    t.check('tap tempo says the tempo', /Tap tempo: \d/.test((await win.textContent('.toast').catch(() => '')) ?? ''), await win.textContent('.toast').catch(() => ''));
    await win.keyboard.press('Control+z');
    await sleep(100);
    t.check('one undo takes back the whole run of taps', (await bpm()) === start, `${tapped} -> ${await bpm()} (was ${start})`);

    // 2. Tap tempo with T, at a faster tempo.
    await blur();
    await sleep(2200);
    await win.evaluate(() => (window.__taps = []));
    for (let i = 0; i < 5; i++) {
      await win.keyboard.press('t');
      if (i < 4) await sleep(375);
    }
    const keyed = await bpm();
    const wantKeyed = await expected();
    t.check('tapping T sets the tempo too (5 taps, the last 4 gaps averaged)', Math.abs(keyed - wantKeyed) <= 0.2 && Math.abs(keyed - 160) <= 25, `${keyed} BPM (taps at ${wantKeyed})`);

    // 3. The mouse wheel on the tempo box.
    const box = win.locator('input[aria-label=BPM]');
    await win.keyboard.press('Control+z');
    await sleep(100);
    const before = await bpm();
    await box.hover();
    for (let i = 0; i < 3; i++) {
      await win.mouse.wheel(0, -100);
      await sleep(40);
    }
    await sleep(100);
    t.check('three wheel notches up add 3 BPM', (await bpm()) === Math.min(300, before + 3), `${before} -> ${await bpm()}`);
    await win.keyboard.down('Shift');
    await win.mouse.wheel(0, 100);
    await win.keyboard.up('Shift');
    await sleep(100);
    t.check('Shift + wheel down takes off 10', (await bpm()) === Math.min(300, before + 3) - 10, await bpm());
    const scrolled = await win.evaluate(() => [document.scrollingElement.scrollTop, document.querySelector('.app')?.scrollTop ?? 0]);
    t.check('the page does not scroll while turning the tempo', scrolled.every((v) => v === 0), scrolled.join(','));
    await blur();
    await win.keyboard.press('Control+z');
    await sleep(100);
    t.check('one undo takes back one burst of wheel turns', (await bpm()) === before, `${await bpm()} (was ${before})`);

    // 4. The keyboard shortcuts list.
    const text = (await win.textContent('.statusbar')) ?? '';
    t.check('the status bar no longer lists shortcuts as text', !/Space play\/stop|arrows \+ Enter/.test(text), text);
    t.check('the step lane hint text is gone', (await win.locator('text=Edit lane: Ctrl+C').count()) === 0);
    await win.click('.statusbar .keys-help');
    const dlg = win.locator('.modal[aria-label="Keyboard shortcuts"]');
    t.check('"? Keyboard shortcuts" opens the list', await dlg.isVisible().catch(() => false));
    const rows = await dlg.locator('.keymap-row').count();
    const listed = (await dlg.textContent()) ?? '';
    t.check('the list has every shortcut, in groups', rows >= 25 && ['Playing', 'Editing the grid', 'Patterns', 'Files'].every((g) => listed.includes(g)), `${rows} shortcuts`);
    t.check('it includes the copy/paste hint that was on the step lane, and tap tempo', listed.includes('Copy / paste the selected track') && listed.includes('Tap tempo'));
    await dlg.locator('button.primary').click();
    t.check('Close shuts the list', !(await dlg.isVisible().catch(() => false)));
    await blur();
    await win.keyboard.press('Shift+Slash');
    t.check('? opens the list too', await dlg.isVisible().catch(() => false));
    await dlg.locator('button.primary').click();
    await blur();
    await win.keyboard.press('F1');
    t.check('and so does F1', await dlg.isVisible().catch(() => false));
    await dlg.locator('button.primary').click();

    // 5. Resting while stopped: the meters stop being read once it is quiet.
    const countMeterReads = (ms) =>
      win.evaluate(async (wait) => {
        const e = window.__engine;
        const orig = e.readMeters;
        let n = 0;
        e.readMeters = function (...a) {
          n++;
          return orig.apply(this, a);
        };
        await new Promise((r) => setTimeout(r, wait));
        e.readMeters = orig;
        return n;
      }, ms);
    await blur();
    await win.click('[data-cell="t1:0"]');
    await blur();
    await win.keyboard.press('Space');
    await win.waitForFunction(() => window.__engine.isPlaying, null, { timeout: 10000 }).catch(() => {});
    const playingReads = await countMeterReads(1000);
    t.check('while playing the meters update every frame', playingReads > 20, `${playingReads} reads in 1 s`);
    await win.keyboard.press('Space');
    await sleep(500);
    const tailReads = await countMeterReads(500);
    t.check('just after stopping they still update (effect tails die away)', tailReads > 5, `${tailReads} reads in 0.5 s`);
    await sleep(7000);
    const idleReads = await countMeterReads(1500);
    t.check('once stopped and quiet the screen rests (no meter work)', idleReads === 0, `${idleReads} reads in 1.5 s`);
    const meters = await win.evaluate(() => [...document.querySelectorAll('.meter-fill')].map((el) => el.style.transform).filter((v) => v && !/scale[XY]\(0\)/.test(v)));
    t.check('and the meters rest at zero', meters.length === 0, meters.slice(0, 3).join(', ') || 'all zero');
    await win.evaluate(() => window.__engine.audition(Object.keys(window.__engine['project'].samples)[0]));
    await sleep(100);
    const wokeReads = await countMeterReads(500);
    t.check('a sound played while stopped wakes the meters', wokeReads > 5, `${wokeReads} reads in 0.5 s`);
    t.check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
  } finally {
    await closeApp(app, win).catch(() => app.close());
  }
}

await runStandalone(import.meta.url, 'Tap tempo, shortcuts list and resting screen', run);

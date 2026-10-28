// Performance view through the real UI: pads queue patterns at the bar line,
// big mute/solo buttons, meters, position display, and back to the editor.
import { closeApp, launchApp, runStandalone } from './lib.mjs';

export async function run(t) {
  const { app, win, pageErrors } = await launchApp();
  try {
    const ids = await win.evaluate(() => window.__engine['project'].patterns.map((p) => p.id));
    await win.keyboard.press('p');
    t.check('P opens the performance view', !!(await win.$('.perform')) && !(await win.$('.grid')));
    t.check('one pad per pattern and a tile per track', (await win.locator('.pad').count()) === ids.length && (await win.locator('.ptrack').count()) === 16);
    t.check('the Song button is off while the song is empty', await win.isDisabled('.perform-top button.small'));

    await win.click('.perform-play');
    await win.waitForTimeout(1200);
    t.check('the big play button starts playback', await win.evaluate(() => window.__engine.isPlaying));
    const pos = await win.textContent('.perform-position');
    t.check('position shows pattern, bar and beat', /^A · bar \d+ · beat [1-4]$/.test(pos ?? ''), pos);
    const meter = await win.evaluate(() => {
      let max = 0;
      const el = document.querySelector('.ptrack .meter-fill');
      return new Promise((r) => {
        const id = setInterval(() => {
          const m = /scaleY\(([\d.]+)\)/.exec(el.style.transform);
          if (m) max = Math.max(max, Number(m[1]));
        }, 20);
        setTimeout(() => (clearInterval(id), r(max)), 1200);
      });
    });
    t.check('the kick meter moves while playing', meter > 0.2, meter.toFixed(2));

    await win.click('.pad >> nth=1');
    const queued = await win.evaluate(() => window.__engine.queued);
    t.check('a pad queues its pattern for the next bar', queued?.patternId === ids[1] && Number.isInteger(queued.atCycle), queued);
    await win.waitForTimeout(50);
    t.check('the pad shows it is coming next', (await win.textContent('.pad >> nth=1'))?.includes('next bar'));
    await win.waitForFunction((id) => window.__engine.audiblePatternId === id, ids[1], { timeout: 6000 }).catch(() => {});
    await win.waitForTimeout(100);
    t.check('at the bar line it plays and its pad lights up', await win.evaluate(() => document.querySelectorAll('.pad')[1].classList.contains('playing') && window.__engine.isPlaying));
    await win.click('.pad >> nth=0');

    await win.click('[aria-label="Mute Kick"]');
    let tr = await win.evaluate(() => window.__engine['project'].tracks[0]);
    t.check('M mutes the track', tr.mute && (await win.getAttribute('[aria-label="Mute Kick"]', 'aria-pressed')) === 'true');
    await win.click('[aria-label="Solo Snare"]');
    tr = await win.evaluate(() => window.__engine['project'].tracks[2]);
    t.check('S solos the track', tr.solo);
    await win.click('[aria-label="Solo Snare"]');
    await win.click('[aria-label="Mute Kick"]');

    await win.click('.perform-play');
    await win.waitForTimeout(100);
    t.check('the big button stops playback', !(await win.evaluate(() => window.__engine.isPlaying)));
    await win.click('.view-toggle');
    t.check('the Edit view button returns to the grid', !!(await win.$('.grid')) && !(await win.$('.perform')));
    t.check('no errors in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
  } finally {
    await closeApp(app, win).catch(() => app.close());
  }
}

await runStandalone(import.meta.url, 'Performance view', run);

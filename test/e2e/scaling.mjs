// Windows display scaling (100/125/150/200 %) and window sizes down to the
// minimum: the page never scrolls sideways, a whole bar of 16 steps is visible
// without scrolling, track names and the inspector fit, and the main buttons
// stay on screen. Screenshots go to test-results/scaling/ for a visual check.
import { mkdirSync } from 'node:fs';
import { closeApp, launchApp, runStandalone } from './lib.mjs';

const SCALES = [1, 1.25, 1.5, 2];
// Logical (DIP) window sizes: the minimum, 1920x1080 at 150 %, 1366x768 at 100 %, 1920x1080 at 100 %.
const SIZES = [
  [1000, 640],
  [1280, 720],
  [1366, 768],
  [1920, 1080],
];

export async function run(t) {
  const dir = 'test-results/scaling';
  mkdirSync(dir, { recursive: true });
  for (const scale of SCALES) {
    const { app, win, pageErrors } = await launchApp(undefined, [`--force-device-scale-factor=${scale}`]);
    try {
      const dpr = await win.evaluate(() => devicePixelRatio);
      t.check(`${scale * 100} %: the app renders at that scale`, dpr === scale, dpr);
      const bad = [];
      for (const [w, h] of SIZES) {
        await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]);
        await win.waitForFunction(([w]) => Math.abs(innerWidth - w) <= 1, [w], { timeout: 5000 }).catch(() => {});
        await win.waitForTimeout(200);
        const r = await win.evaluate(() => {
          const over = (el) => (el ? el.scrollWidth - el.clientWidth : -1);
          const grid = document.querySelector('.grid').parentElement.getBoundingClientRect();
          const cell = (n) => document.querySelector(`[data-cell="t1:${n}"]`)?.getBoundingClientRect();
          const inView = (b) => !!b && b.left >= 0 && b.top >= 0 && b.right <= innerWidth + 0.5 && b.bottom <= innerHeight + 0.5;
          return {
            page: document.documentElement.scrollWidth - innerWidth,
            barVisible: !!cell(0) && !!cell(15) && cell(0).left >= grid.left && cell(15).right <= grid.right + 0.5,
            names: [...document.querySelectorAll('.track-name')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent),
            inspector: over(document.querySelector('.inspector')),
            buttons: ['Play', 'Export WAV', 'Perform', 'About'].filter((label) => {
              const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().endsWith(label));
              return !inView(b?.getBoundingClientRect());
            }),
          };
        });
        const problems = [
          r.page > 0 && `page scrolls sideways by ${r.page}px`,
          !r.barVisible && 'a whole bar of 16 steps is not visible',
          r.names.length && `cut-off track names: ${r.names.join(', ')}`,
          r.inspector > 0 && `inspector overflows by ${r.inspector}px`,
          r.buttons.length && `off screen: ${r.buttons.join(', ')}`,
        ].filter(Boolean);
        if (problems.length) bad.push(`${w}x${h}: ${problems.join('; ')}`);
        await win.screenshot({ path: `${dir}/${scale * 100}pct-${w}x${h}.png` });
      }
      t.check(`${scale * 100} %: layout fits at ${SIZES.map(([w, h]) => `${w}x${h}`).join(', ')}`, bad.length === 0, bad.join(' | ') || 'all fit');

      // The performance view at the smallest size.
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 640));
      await win.waitForTimeout(200);
      await win.keyboard.press('p');
      await win.waitForSelector('.perform');
      const perf = await win.evaluate(() => {
        const inView = (el) => {
          const b = el.getBoundingClientRect();
          return b.left >= 0 && b.right <= innerWidth + 0.5 && b.width > 0;
        };
        return { pads: [...document.querySelectorAll('.pad')].every(inView), mutes: [...document.querySelectorAll('.ptrack-mute')].every(inView), page: document.documentElement.scrollWidth - innerWidth };
      });
      await win.screenshot({ path: `${dir}/${scale * 100}pct-perform-1000x640.png` });
      t.check(`${scale * 100} %: performance view fits the smallest window`, perf.pads && perf.mutes && perf.page <= 0, perf);
      await win.keyboard.press('p');
      t.check(`${scale * 100} %: no errors in the page`, pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
    } finally {
      await closeApp(app, win).catch(() => app.close());
    }
  }
}

await runStandalone(import.meta.url, 'Display scaling', run);

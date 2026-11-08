// The redesigned main screen: tool panel tabs under the grid, bar pages that
// follow the playhead, painting steps by dragging, the loudness/chance/timing
// lane, track colours, and a top bar that stays on one line.
import { closeApp, launchApp, newProfile, openTool, runStandalone } from './lib.mjs';

export async function run(t) {
  const profile = newProfile();
  let { app, win, pageErrors } = await launchApp(profile);
  win.setDefaultTimeout(15000);
  const sleep = (ms) => win.waitForTimeout(ms);
  const lane = (track) =>
    win.evaluate((track) => {
      const p = window.__engine['project'];
      return p.patterns.find((x) => x.id === p.currentPatternId).lanes[track].steps;
    }, track);
  const onString = async (track, n = 16) => (await lane(track)).slice(0, n).map((s) => (s.on ? 'x' : '.')).join('');
  const centre = async (sel) => {
    const b = await win.locator(sel).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
  };
  const undo = async () => {
    await win.evaluate(() => document.activeElement?.blur());
    await win.keyboard.press('Control+z');
    await sleep(100);
  };

  try {
    // 1. Tool panel.
    const tabs = await win.locator('.tools-tabs [role=tab]').allTextContents();
    t.check('the tools are tabs under the grid', tabs.join('|') === 'Beat library|Beat intelligence|Generate|Pads', tabs.join('|'));
    const scroll = await win.evaluate(() => {
      const c = document.querySelector('.center');
      return { page: document.documentElement.scrollHeight - innerHeight, centre: c.scrollHeight - c.clientHeight };
    });
    t.check('the main screen does not scroll as a whole any more', scroll.page <= 0 && scroll.centre <= 0, scroll);
    const visibleTools = await win.evaluate(() => ['.beatlib', '.smart', '.generate'].filter((s) => document.querySelector(s)?.offsetParent));
    t.check('one tool is shown at a time (Beat library first)', visibleTools.join() === '.beatlib', visibleTools.join());
    await openTool(win, 'Generate');
    const hits = win.locator('.generate [aria-label="Euclidean"] .slider:has(label:text-is("Hits")) input');
    await hits.fill('5');
    await openTool(win, 'Beat library');
    await openTool(win, 'Generate');
    t.check('a tool keeps its settings when you switch tabs', (await hits.inputValue()) === '5', await hits.inputValue());
    await win.click('.tools-toggle');
    await sleep(200);
    const folded = await win.evaluate(() => ({ body: !!document.querySelector('.tools-body')?.offsetParent, tabs: !!document.querySelector('.tools-tabs')?.offsetParent }));
    t.check('Hide folds the tools away and keeps the tabs', !folded.body && folded.tabs, folded);
    const gridRoom = await win.evaluate(() => document.querySelector('.grid-area').clientHeight);
    await win.click('.tools-tabs [role=tab]:has-text("Beat intelligence")');
    await sleep(200);
    t.check('a tab opens the tools again, on that tab', await win.isVisible('.smart'));
    t.check('folding the tools gives the grid more room', gridRoom > (await win.evaluate(() => document.querySelector('.grid-area').clientHeight)), gridRoom);
    await sleep(500); // settings are written as you go
    await closeApp(app, win);
    ({ app, win, pageErrors } = await launchApp(profile));
    t.check('the open tab is remembered after a restart', await win.isVisible('.smart'));

    // 2. Track colours.
    for (const c of ['t1:1', 't3:1']) await win.click(`[data-cell="${c}"]`);
    const colours = await win.evaluate(() => ['t1:1', 't3:1'].map((c) => getComputedStyle(document.querySelector(`[data-cell="${c}"]`)).backgroundColor));
    t.check('each track lights its steps in its own colour', colours[0] !== colours[1], colours.join(' / '));

    // 3. Painting by dragging.
    await win.evaluate(() => document.activeElement?.blur());
    const before = await onString('t2');
    let a = await centre('[data-cell="t2:2"]');
    let b = await centre('[data-cell="t2:7"]');
    await win.mouse.move(a.x, a.y);
    await win.mouse.down();
    await win.mouse.move(b.x, b.y, { steps: 12 });
    await win.mouse.up();
    await sleep(150);
    const painted = await onString('t2');
    t.check('dragging across empty steps switches them all on', painted.slice(2, 8) === 'xxxxxx', `${before} -> ${painted}`);
    a = await centre('[data-cell="t2:4"]');
    b = await centre('[data-cell="t2:6"]');
    await win.mouse.move(a.x, a.y);
    await win.mouse.down();
    await win.mouse.move(b.x, b.y, { steps: 8 });
    await win.mouse.up();
    await sleep(150);
    const erased = await onString('t2');
    t.check('dragging from a lit step switches them off', erased.slice(2, 8) === 'xx...x', erased);
    await undo();
    t.check('one undo takes back the whole erase drag', (await onString('t2')).slice(2, 8) === 'xxxxxx', await onString('t2'));
    await undo();
    t.check('another undo takes back the whole paint drag', (await onString('t2')) === before, await onString('t2'));
    await win.click('[data-cell="t2:9"]');
    t.check('a single click still switches one step', (await onString('t2'))[9] === 'x');

    // 4. The loudness lane follows the selected track (track 2 now).
    await win.locator('.step-lane').scrollIntoViewIfNeeded();
    const bars = await centre('.step-lane-bars');
    const slot = await centre('.lane-slot[data-lane-step="9"]');
    await win.mouse.move(slot.x, bars.b.y + bars.b.height * 0.75);
    await win.mouse.down();
    await win.mouse.up();
    await sleep(100);
    let st = (await lane('t2'))[9];
    t.check('clicking low in the loudness lane makes the step quieter', Math.abs(st.velocity - 0.25) < 0.05, st.velocity);
    // Drag across: steps that are off are left alone.
    const offBefore = (await lane('t2'))[1];
    const s0 = await centre('.lane-slot[data-lane-step="0"]');
    const s9 = await centre('.lane-slot[data-lane-step="9"]');
    await win.mouse.move(s0.x, bars.b.y + 2);
    await win.mouse.down();
    await win.mouse.move(s9.x, bars.b.y + 2, { steps: 12 });
    await win.mouse.up();
    await sleep(100);
    const steps = await lane('t2');
    t.check('drawing across the lane sets every lit step it crosses', steps[9].velocity > 0.95, steps[9].velocity);
    t.check('steps that are off are not changed', !offBefore.on && JSON.stringify(steps[1]) === JSON.stringify(offBefore), steps[1]);
    await undo();
    t.check('one undo takes back the whole lane drag', Math.abs((await lane('t2'))[9].velocity - 0.25) < 0.05);
    await win.click('.step-lane-kinds button:has-text("Timing")');
    await win.mouse.move(slot.x, bars.b.y + 2);
    await win.mouse.down();
    await win.mouse.up();
    st = (await lane('t2'))[9];
    t.check('the Timing lane pushes a step late', st.micro > 0.4, st.micro);
    await win.click('.step-lane-kinds button:has-text("Chance")');
    await win.mouse.move(slot.x, bars.b.y + bars.b.height / 2);
    await win.mouse.down();
    await win.mouse.up();
    st = (await lane('t2'))[9];
    t.check('the Chance lane sets the chance a step plays', Math.abs(st.probability - 0.5) < 0.05, st.probability);
    t.check('the grid shows the chance on the step', !!(await win.$('[data-cell="t2:9"] .prob')));
    await win.click('.step-lane-kinds button:has-text("Loudness")');

    // 5. Bar pages on a 4-bar beat.
    await openTool(win, 'Beat library');
    await win.selectOption('.beatlib select[aria-label="Beat"]', 'amen');
    await win.selectOption('.beatlib select[aria-label="Variant"]', '0');
    await win.click('.beatlib button:has-text("Load beat")');
    await sleep(300);
    const pages = await win.locator('.page-btn').allTextContents();
    t.check('a 4-bar beat gets bar pages', pages.length >= 2, pages.join(' '));
    const ruler = await win.evaluate(() => [...document.querySelectorAll('.ruler-cell')].map((c) => c.textContent).filter(Boolean).slice(0, 5));
    t.check('the ruler counts bars and beats (1, 1.2, 1.3 …)', ruler.slice(0, 3).join(' ') === '1 1.2 1.3', ruler.join(' '));
    const fits = await win.evaluate(() => {
      const area = document.querySelector('.grid-area');
      const steps = document.querySelectorAll('.row .steps')[0].getBoundingClientRect();
      return steps.right <= area.getBoundingClientRect().right + 0.5;
    });
    t.check('the bars on screen fit without scrolling sideways', fits);
    await win.click('.page-btn >> nth=1');
    const first = await win.evaluate(() => document.querySelector('.row .steps .cell').dataset.step);
    t.check('a page button shows those bars', Number(first) > 0, first);
    await win.click('.page-btn >> nth=0');
    await win.evaluate(() => document.activeElement?.blur());
    await win.keyboard.press('Space');
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      seen.add(await win.evaluate(() => [...document.querySelectorAll('.page-btn')].findIndex((b) => b.classList.contains('on'))));
    }
    t.check('while playing, the pages turn with the playhead', seen.size >= 2, [...seen].join(','));
    const lit = await win.evaluate(() => document.querySelectorAll('.cell.play').length);
    t.check('the playhead is drawn on the page being shown', lit > 0, lit);
    await win.uncheck('.follow input');
    const held = await win.evaluate(() => [...document.querySelectorAll('.page-btn')].findIndex((b) => b.classList.contains('on')));
    await sleep(4000);
    const still = await win.evaluate(() => [...document.querySelectorAll('.page-btn')].findIndex((b) => b.classList.contains('on')));
    t.check('with Follow off the page stays put', held === still, `${held} -> ${still}`);
    await win.evaluate(() => document.activeElement?.blur());
    await win.keyboard.press('Space');

    // 6. The top bar stays on one line on common screens.
    const lines = [];
    for (const [w, h] of [
      [1920, 1080],
      [1366, 768],
      [1280, 720],
    ]) {
      await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]);
      await win.waitForFunction(([w]) => Math.abs(innerWidth - w) <= 1, [w], { timeout: 5000 }).catch(() => {});
      await sleep(200);
      lines.push(`${w}: ${await win.evaluate(() => document.querySelector('.topbar').offsetHeight)} px`);
    }
    t.check('the top bar is one line at 1920, 1366 and 1280 wide', lines.every((l) => Number(l.split(': ')[1].split(' ')[0]) < 60), lines.join(', '));
    t.check('no page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
  } finally {
    await closeApp(app, win);
  }
}

await runStandalone(import.meta.url, 'Main screen: tools, bar pages, painting and the step lane', run);

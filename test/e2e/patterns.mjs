// Pattern list through the real UI: drag to reorder (ABCD -> ACBD), keys follow
// the new order, remove with confirmation and undo, reorder the song by dragging.
import { closeApp, launchApp, runStandalone } from './lib.mjs';

export async function run(t) {
  const { app, win, pageErrors } = await launchApp();
  try {
    const order = () => win.evaluate(() => window.__engine['project'].patterns.map((p) => p.name).join(''));
    const tab = (name) => win.locator(`.patternbar .pattern-btn:text-is("${name}")`);
    const dragOnto = async (src, dst, side) => {
      const box = await dst.boundingBox();
      await src.dragTo(dst, { targetPosition: { x: side === 'left' ? 4 : box.width - 4, y: box.height / 2 } });
      await win.waitForTimeout(150);
    };

    t.check('starts with ABCD', (await order()) === 'ABCD');
    await dragOnto(tab('C'), tab('B'), 'left');
    t.check('dragging C onto the left of B gives ACBD', (await order()) === 'ACBD', await order());
    t.check('the tabs show the new order', (await win.$$eval('.patternbar .pattern-btn', (b) => b.map((x) => x.textContent).join(''))) === 'ACBD');
    await win.keyboard.press('2');
    t.check('key 2 now selects C (keys follow the order)', (await win.textContent('.pattern-btn.current')) === 'C');
    await dragOnto(tab('A'), tab('D'), 'right');
    t.check('dragging A to the right of D gives CBDA', (await order()) === 'CBDA', await order());
    await win.keyboard.press('Control+z');
    await win.keyboard.press('Control+z');
    t.check('undo restores ABCD', (await order()) === 'ABCD', await order());
    await win.keyboard.press('3');
    await win.keyboard.press('Alt+ArrowLeft');
    t.check('Alt+Left moves the current pattern one place left', (await order()) === 'ACBD', await order());
    await win.keyboard.press('Control+z');

    // Song entries reorder by dragging too.
    for (const k of ['1', '2', '3']) {
      await win.keyboard.press(k);
      await win.click('.songbar .add');
    }
    const songNames = () => win.$$eval('.song-entry .name', (b) => b.map((x) => x.textContent).join(''));
    t.check('song is ABC', (await songNames()) === 'ABC');
    await dragOnto(win.locator('.song-entry >> nth=2 >> .name'), win.locator('.song-entry >> nth=0'), 'right');
    t.check('dragging a song entry reorders the song (ACB)', (await songNames()) === 'ACB', await songNames());

    // Remove: an empty, unused pattern goes at once.
    await win.keyboard.press('4');
    await win.click('.patternbar button:text-is("Remove")');
    t.check('an empty pattern that is not in the song is removed straight away', (await order()) === 'ABC', await order());
    t.check('its neighbour becomes current', (await win.textContent('.pattern-btn.current')) === 'C');

    // A pattern with steps that the song uses asks first.
    await win.keyboard.press('1');
    await win.keyboard.press('Space');
    await win.waitForTimeout(600);
    await win.click('.patternbar button:text-is("Remove")');
    const text = await win.textContent('.modal').catch(() => '');
    t.check('removing a pattern with steps asks first, with what will be lost', /14 steps/.test(text) && /used 1 time in the song/.test(text), text?.replace(/\s+/g, ' ').slice(0, 120));
    await win.click('.modal button:text-is("Cancel")');
    t.check('Cancel keeps it', (await order()) === 'ABC');
    await win.keyboard.press('Control+Delete');
    await win.click('.modal button.danger');
    await win.waitForTimeout(200);
    const after = await win.evaluate(() => ({ names: window.__engine['project'].patterns.map((p) => p.name).join(''), song: window.__engine['project'].song.length, queued: window.__engine.queued, playing: window.__engine.isPlaying }));
    t.check('Remove (Ctrl+Delete) deletes it and its song entry', after.names === 'BC' && after.song === 2, after);
    t.check('it was playing, so the new current pattern takes over at the next bar without stopping', after.playing && after.queued && Number.isInteger(after.queued.atCycle), after.queued);
    await win.keyboard.press('Space');
    await win.keyboard.press('Control+z');
    const back = await win.evaluate(() => ({ names: window.__engine['project'].patterns.map((p) => p.name).join(''), song: window.__engine['project'].song.length }));
    t.check('undo brings the pattern and its song entry back', back.names === 'ABC' && back.song === 3, back);
    t.check('no errors in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
  } finally {
    await closeApp(app, win).catch(() => app.close());
  }
}

await runStandalone(import.meta.url, 'Pattern list', run);

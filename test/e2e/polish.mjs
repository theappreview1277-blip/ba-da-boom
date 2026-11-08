// Round 4 polish, through the real UI: the welcome screen on first start, the
// logo, knobs in the sound panel, and the Mixer tab.
import { closeApp, launchApp, newProfile, openTool, runStandalone } from './lib.mjs';

export async function run(t) {
  const profile = newProfile();
  let { app, win, pageErrors } = await launchApp(profile, [], {}, { welcome: true });
  win.setDefaultTimeout(15000);
  const sleep = (ms) => win.waitForTimeout(ms);
  const project = () => win.evaluate(() => window.__engine['project']);
  const blur = () => win.evaluate(() => document.activeElement?.blur());
  try {
    // 1. Welcome screen and logo.
    const welcome = win.locator('.modal[aria-label="Welcome to Ba-da-boom"]');
    t.check('the first start shows the welcome screen', await welcome.isVisible().catch(() => false));
    t.check('the welcome screen and the top bar show the logo', (await win.locator('.welcome svg.logo').count()) === 1 && (await win.locator('.brand svg.logo').count()) === 1);
    await welcome.locator('button:has-text("Browse the Beat library")').click();
    await sleep(300);
    t.check('"Browse the Beat library" opens the Beat library', !(await welcome.isVisible().catch(() => false)) && (await win.isVisible('.beatlib')));
    await sleep(500);
    await closeApp(app, win);
    ({ app, win, pageErrors } = await launchApp(profile, [], {}, { welcome: true }));
    t.check('the next start goes straight to work', !(await win.locator('.modal[aria-label="Welcome to Ba-da-boom"]').isVisible().catch(() => false)));
    await win.click('button.about');
    await win.click('.modal button:has-text("Welcome screen")');
    t.check('About can show the welcome screen again', await win.locator('.modal[aria-label="Welcome to Ba-da-boom"]').isVisible());
    await win.click('.modal button:has-text("Start with this beat")');

    // 2. Knobs.
    const knob = (label) => win.locator(`.inspector .slider.knob:has(label:text-is("${label}")) .knob-input`);
    const volBefore = (await project()).tracks[0].sound.volume;
    const box = await knob('Volume').boundingBox();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.mouse.down();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 30, { steps: 6 });
    await win.mouse.up();
    const volUp = (await project()).tracks[0].sound.volume;
    t.check('dragging a knob up turns it up', volUp > volBefore + 0.1, `${volBefore} -> ${volUp}`);
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.mouse.down();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 40, { steps: 6 });
    await win.mouse.up();
    const volDown = (await project()).tracks[0].sound.volume;
    t.check('dragging it down turns it down', volDown < volUp - 0.1, `${volUp} -> ${volDown}`);
    await blur();
    await win.keyboard.press('Control+z');
    t.check('one undo takes back one whole drag', Math.abs((await project()).tracks[0].sound.volume - volUp) < 1e-9, (await project()).tracks[0].sound.volume);
    await knob('Pan').dblclick();
    await knob('Volume').dblclick();
    t.check('double-clicking a knob resets it', Math.abs((await project()).tracks[0].sound.volume - volBefore) < 1e-9, (await project()).tracks[0].sound.volume);
    await knob('Pan').focus();
    await win.keyboard.press('ArrowRight');
    await win.keyboard.press('ArrowRight');
    const pan = (await project()).tracks[0].sound.pan;
    t.check('arrow keys turn a focused knob', pan > 0.01, pan);
    t.check('the knob shows its value', (await win.textContent('.inspector .slider.knob:has(label:text-is("Pan")) output')) === `R${Math.round(pan * 100)}`);
    t.check('the sound panel has knobs for every setting', (await win.locator('.inspector .slider.knob').count()) >= 20, await win.locator('.inspector .slider.knob').count());

    // 3. Mixer.
    await openTool(win, 'Mixer');
    const strips = await win.locator('.mixer .strip[data-strip]').count();
    t.check('the Mixer has a strip per track and a master strip', strips === 16 && (await win.locator('.mixer .master-strip').count()) === 1, strips);
    const fader = win.locator('.mixer .strip[data-strip="2"] input.fader');
    await fader.fill('0.5');
    t.check('a fader sets that track\'s level', Math.abs((await project()).tracks[2].sound.volume - 0.5) < 1e-9, (await project()).tracks[2].sound.volume);
    t.check('the strip shows the level in dB', (await win.textContent('.mixer .strip[data-strip="2"] .strip-db')) === '-6.0 dB', await win.textContent('.mixer .strip[data-strip="2"] .strip-db'));
    await win.click('.mixer .strip[data-strip="5"] .strip-ms button:has-text("M")');
    t.check('M in the mixer mutes the track (and the grid shows it)', (await project()).tracks[5].mute && (await win.getAttribute('.row[role=row] >> nth=5 >> button:has-text("M")', 'aria-pressed')) === 'true');
    await win.click('.mixer .strip[data-strip="5"] .strip-ms button:has-text("M")');
    await win.locator('.mixer .strip[data-strip="3"] .slider.knob:has(label:text-is("Rev")) .knob-input').fill('0.4');
    t.check('the reverb knob sets the send', Math.abs((await project()).tracks[3].sound.reverbSend - 0.4) < 1e-9);
    await win.locator('.mixer .master-strip input.fader').fill('1');
    t.check('the master fader sets the master level', (await project()).masterVolume === 1);
    await win.click('.mixer .strip[data-strip="7"] .strip-name');
    t.check('clicking a strip selects its track', (await win.inputValue('.track-rename')) === 'Low Tom', await win.inputValue('.track-rename'));
    await blur();
    await win.keyboard.press('Space');
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      await sleep(50);
      peak = Math.max(peak, await win.evaluate(() => Number(/scaleY\(([\d.]+)\)/.exec(document.querySelector('.mixer .strip[data-strip="0"] .meter-fill').style.transform)?.[1] ?? 0)));
    }
    await win.keyboard.press('Space');
    t.check('the mixer meters move while playing', peak > 0.2, peak.toFixed(2));
    t.check('no page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
  } finally {
    await closeApp(app, win);
  }
}

await runStandalone(import.meta.url, 'Welcome screen, knobs and mixer', run);

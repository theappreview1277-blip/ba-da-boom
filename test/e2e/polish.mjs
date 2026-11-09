// Round 4 polish, through the real UI: the welcome screen on first start, the
// logo, knobs in the sound panel, the Mixer tab, and each control having one
// place on the main screen.
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
    const pitchOf = async () => (await project()).tracks[0].sound.pitch;
    const pitchBefore = await pitchOf();
    const box = await knob('Pitch').boundingBox();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.mouse.down();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 30, { steps: 6 });
    await win.mouse.up();
    const pitchUp = await pitchOf();
    t.check('dragging a knob up turns it up', pitchUp > pitchBefore, `${pitchBefore} -> ${pitchUp}`);
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.mouse.down();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 40, { steps: 6 });
    await win.mouse.up();
    const pitchDown = await pitchOf();
    t.check('dragging it down turns it down', pitchDown < pitchUp, `${pitchUp} -> ${pitchDown}`);
    await blur();
    await win.keyboard.press('Control+z');
    t.check('one undo takes back one whole drag', (await pitchOf()) === pitchUp, await pitchOf());
    await knob('Pitch').dblclick();
    t.check('double-clicking a knob resets it', (await pitchOf()) === pitchBefore, await pitchOf());
    await knob('Start').focus();
    await win.keyboard.press('ArrowRight');
    await win.keyboard.press('ArrowRight');
    const start = (await project()).tracks[0].sound.start;
    t.check('arrow keys turn a focused knob', start > 0.005, start);
    t.check('the knob shows its value', (await win.textContent('.inspector .slider.knob:has(label:text-is("Start")) output')) === `${Math.round(start * 100)}%`);
    await knob('Start').dblclick();
    t.check('the sound panel has knobs for every setting', (await win.locator('.inspector .slider.knob').count()) >= 20, await win.locator('.inspector .slider.knob').count());

    // 3. Mixer.
    await openTool(win, 'Mixer');
    const strips = await win.locator('.mixer .strip[data-strip]').count();
    t.check('the Mixer has a strip per track', strips === 16, strips);
    const fader = win.locator('.mixer .strip[data-strip="2"] input.fader');
    await fader.fill('0.5');
    t.check('a fader sets that track\'s level', Math.abs((await project()).tracks[2].sound.volume - 0.5) < 1e-9, (await project()).tracks[2].sound.volume);
    t.check('the strip shows the level in dB', (await win.textContent('.mixer .strip[data-strip="2"] .strip-db')) === '-6.0 dB', await win.textContent('.mixer .strip[data-strip="2"] .strip-db'));
    await win.locator('.mixer .strip[data-strip="3"] .slider.knob:has(label:text-is("Rev")) .knob-input').fill('0.4');
    t.check('the reverb knob sets the send', Math.abs((await project()).tracks[3].sound.reverbSend - 0.4) < 1e-9);
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

    // 4. Each control has one place on the main screen.
    const inspectorLabels = await win.$$eval('.inspector label', (ls) => ls.map((l) => l.textContent.trim()));
    const doubled = ['Volume', 'Pan', 'Velocity', 'Probability', 'Microtiming', 'Delay send', 'Reverb send', 'On'].filter((l) => inspectorLabels.includes(l));
    t.check('the sound panel leaves level, pan, sends and step loudness/chance/timing to the Mixer and the strip', doubled.length === 0, doubled.join(', ') || 'none doubled');
    t.check('the Mixer leaves mute/solo to the track rows and the master level to the top bar', (await win.locator('.mixer button:has-text("M"), .mixer button:has-text("S"), .mixer .master-strip').count()) === 0);
    await openTool(win, 'Beat library');
    await win.click('.inspector button.to-mixer');
    t.check('"Level, pan and effects are in the Mixer" opens the Mixer', await win.locator('.mixer').isVisible());
    await win.click('button.settings-btn');
    const settingsText = (await win.textContent('.modal')) ?? '';
    t.check('Settings no longer repeats the pad options (they are on the Pads tab)', settingsText.length > 0 && !settingsText.includes('Snap recorded hits') && !settingsText.includes('Keys play the pads'), settingsText.slice(0, 80) || 'Settings did not open');
    await win.click('.modal button:has-text("Close")');

    const leftWidth = () => win.evaluate(() => Math.round(document.querySelector('aside.left').getBoundingClientRect().width));
    const open = await leftWidth();
    await win.click('.browser-title button:has-text("Hide")');
    const folded = await leftWidth();
    t.check('Hide folds the sample list to a narrow strip', folded < 50 && (await win.locator('.browser').count()) === 0, `${open}px -> ${folded}px`);
    await win.click('.inspector .sample-line button:has-text("Change")');
    t.check('"Change" on the sound panel brings the sample list back', (await win.locator('.browser').count()) === 1 && (await leftWidth()) > 100);
    await win.click('.browser-title button:has-text("Hide")');
    await sleep(300);
    await closeApp(app, win);
    ({ app, win, pageErrors } = await launchApp(profile));
    t.check('a folded sample list stays folded next time', (await win.locator('.samples-rail').count()) === 1 && (await win.locator('.browser').count()) === 0);
    await win.click('.samples-rail');
    t.check('the Sounds strip opens the sample list again', (await win.locator('.browser').count()) === 1);
    t.check('no page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
  } finally {
    await closeApp(app, win);
  }
}

await runStandalone(import.meta.url, 'Welcome screen, knobs and mixer', run);

// Playing live, through the real UI: the Pads tab, recording hits into the
// pattern (snapped or with their timing), one undo per take, letter keys
// playing pads, a MIDI controller (a stand-in for one, since test machines have
// none), and choosing the sound card (stand-in sound cards), remembered after a restart.
import { closeApp, launchApp, newProfile, openTool, runStandalone } from './lib.mjs';

/** Stand-ins for MIDI and sound cards, installed before the app's own code runs. */
const fakes = (outputs) => `(() => {
  const inputs = new Map();
  const access = { inputs, outputs: new Map(), sysexEnabled: false, onstatechange: null };
  const input = (name) => ({ id: name, name, type: 'input', state: 'connected', onmidimessage: null });
  inputs.set('Test Pads', input('Test Pads'));
  window.__fakeMidi = {
    send(name, bytes) { inputs.get(name)?.onmidimessage?.({ data: new Uint8Array(bytes) }); },
    plug(name) { inputs.set(name, input(name)); access.onstatechange?.({}); },
  };
  navigator.requestMIDIAccess = async () => access;
  window.__fakeOutputs = ${JSON.stringify(outputs)};
  navigator.mediaDevices.enumerateDevices = async () => window.__fakeOutputs.map((d) => ({ ...d, kind: 'audiooutput', groupId: '' }));
  window.__sinkCalls = [];
  AudioContext.prototype.setSinkId = async function (id) {
    window.__sinkCalls.push(id);
    Object.defineProperty(this, 'sinkId', { value: id, configurable: true });
  };
})();`;

const SPEAKERS = { deviceId: 'spk-1', label: 'Studio Speakers' };
const PHONES = { deviceId: 'hp-2', label: 'Headphones' };

async function withFakes(win, outputs) {
  await win.addInitScript(fakes(outputs));
  await win.reload();
  await win.waitForFunction(() => window.__engine?.['status']?.size >= 18 && [...window.__engine['status'].values()].every((s) => s !== 'loading'), null, { timeout: 30000 });
  await win.waitForFunction(() => window.__engine.ac.currentTime > 0, null, { timeout: 10000 });
  // A reload looks like a crash to the app, so it offers to recover the work: take it.
  const recover = win.locator('.modal button:has-text("Recover")');
  if (await recover.waitFor({ timeout: 2000 }).then(() => true, () => false)) await recover.click();
  await win.waitForTimeout(200);
  await win.waitForFunction(() => [...window.__engine['status'].values()].every((s) => s !== 'loading'), null, { timeout: 30000 });
}

export async function run(t) {
  const profile = newProfile();
  let { app, win, pageErrors } = await launchApp(profile);
  win.setDefaultTimeout(15000);
  const sleep = (ms) => win.waitForTimeout(ms);
  const project = () => win.evaluate(() => window.__engine['project']);
  const laneOf = (track) =>
    win.evaluate((track) => {
      const p = window.__engine['project'];
      return p.patterns.find((x) => x.id === p.currentPatternId).lanes[p.tracks[track].id].steps;
    }, track);
  const ons = async (track) => (await laneOf(track)).map((s, i) => (s.on ? i : -1)).filter((i) => i >= 0);
  /** Hit pad i with the mouse; returns the pattern position the app saw at that moment. */
  const hitPad = (i, at = 0.5) =>
    win.evaluate(
      ([i, at]) => {
        const pad = document.querySelector(`.drum-pad[data-pad="${i}"]`);
        const r = pad.getBoundingClientRect();
        const cycle = window.__engine.patternCycle();
        pad.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: r.left + 5, clientY: r.top + r.height * at }));
        return cycle;
      },
      [i, at],
    );
  const trackPeak = async (i, ms = 800) => {
    let peak = 0;
    for (let n = 0; n < ms / 40; n++) {
      await sleep(40);
      peak = Math.max(peak, await win.evaluate((i) => window.__engine.readMeters(16).tracks[i] ?? 0, i));
    }
    return peak;
  };
  const blur = () => win.evaluate(() => document.activeElement?.blur());

  try {
    // 1. The Pads tab.
    await openTool(win, 'Pads');
    const names = await win.locator('.drum-pad .pad-track').allTextContents();
    const tracks = (await project()).tracks.map((x) => x.name);
    t.check('the Pads tab has a pad for each track', JSON.stringify(names) === JSON.stringify(tracks), names.join(', '));
    const before = JSON.stringify(await project());
    await hitPad(3);
    const peak = await trackPeak(3);
    t.check('hitting a pad plays that track (its meter moves)', peak > 0.01, peak.toFixed(3));
    t.check('hitting a pad while stopped does not change the beat', JSON.stringify(await project()) === before);

    // 2. Recording: Record starts playback, hits land on the nearest step.
    t.check('the clap lane starts empty', (await ons(3)).length === 0, (await ons(3)).join());
    await win.click('.pads .rec');
    await win.waitForFunction(() => window.__engine.isPlaying, null, { timeout: 5000 }).catch(() => {});
    t.check('Record starts playing', await win.evaluate(() => window.__engine.isPlaying));
    t.check('the Record button shows it is recording', (await win.getAttribute('.pads .rec', 'aria-pressed')) === 'true');
    const expected = new Set();
    const hits = [];
    for (let n = 0; n < 5; n++) {
      await sleep(330);
      const c = await hitPad(3, 0.1);
      if (c != null) {
        expected.add(((Math.round(c * 16) % 16) + 16) % 16);
        hits.push(c * 16);
      }
    }
    await sleep(100);
    const got = await ons(3);
    // The test reads the position a moment before the app does, so a hit right
    // on the middle between two steps (within 0.05 of a step) may go either way.
    const nearHit = (s) => hits.some((h) => Math.abs(((h - s + 8) % 16 + 16) % 16 - 8) <= 0.55);
    t.check('each hit is written on the nearest step', got.length === expected.size && got.every(nearHit), `${got.join(',')} (expected ${[...expected].join(',')}; hit at ${hits.map((h) => (((h % 16) + 16) % 16).toFixed(2)).join(',')})`);
    const vel = (await laneOf(3))[got[0]]?.velocity;
    t.check('a hit near the top of a pad records loud', vel > 0.9, vel);
    await blur();
    await win.keyboard.press('Space');
    await sleep(200);
    t.check('stopping turns Record off', (await win.getAttribute('.pads .rec', 'aria-pressed')) === 'false');
    await blur();
    await win.keyboard.press('Control+z');
    await sleep(150);
    t.check('one undo takes back the whole take', (await ons(3)).length === 0, (await ons(3)).join());

    // 3. Without snapping, hits keep their timing.
    await win.uncheck('.pads-head input[type=checkbox] >> nth=0');
    await blur();
    await win.keyboard.press('r');
    await win.waitForFunction(() => window.__engine.isPlaying, null, { timeout: 5000 }).catch(() => {});
    t.check('R starts recording too', (await win.getAttribute('.pads .rec', 'aria-pressed')) === 'true');
    await sleep(410);
    const c = await hitPad(4);
    await sleep(100);
    await win.keyboard.press('Space');
    const pos = c * 16;
    const near = Math.round(pos);
    const st = (await laneOf(4))[((near % 16) + 16) % 16];
    t.check('with Snap off a hit keeps how early or late it was', st?.on && Math.abs(st.micro - (pos - near)) < 0.02, st && `${st.micro} vs ${(pos - near).toFixed(3)}`);
    await win.check('.pads-head input[type=checkbox] >> nth=0');

    // 4. Letter keys play pads.
    await win.check('.pads-head input[type=checkbox] >> nth=1');
    const sel = (await project()).tracks[0];
    await blur();
    await win.keyboard.press('s'); // pad 10 (Cowbell), not "solo"
    const cowbell = await trackPeak(9);
    const after = (await project()).tracks[0];
    t.check('with Keys play pads on, S plays pad 10 instead of soloing', cowbell > 0.01 && after.solo === sel.solo, cowbell.toFixed(3));
    t.check('the pads show their keys', (await win.locator('.drum-pad >> nth=0 >> kbd').textContent()) === 'Z');

    // 5. A MIDI controller.
    await withFakes(win, [SPEAKERS, PHONES]);
    await openTool(win, 'Pads');
    await win.waitForSelector('.midi-status:has-text("Test Pads")', { timeout: 5000 }).catch(() => {});
    t.check('a connected MIDI controller is found', (await win.textContent('.midi-status')).includes('Test Pads'), await win.textContent('.midi-status'));
    await win.evaluate(() => window.__fakeMidi.send('Test Pads', [0x99, 38, 127]));
    const snare = await trackPeak(2);
    t.check('a General MIDI snare note (38) plays the snare track', snare > 0.01, snare.toFixed(3));
    await win.click('button.settings-btn');
    await win.evaluate(() => window.__fakeMidi.send('Test Pads', [0x99, 42, 90]));
    await sleep(100);
    t.check('Settings shows the last note and what it played', /Last note: F#1 \(42\) from Test Pads played Closed Hat/.test(await win.textContent('.midi-last')), await win.textContent('.midi-last'));
    await win.selectOption('select[aria-label="MIDI notes"]', 'pads36');
    await win.evaluate(() => window.__fakeMidi.send('Test Pads', [0x90, 40, 100]));
    await sleep(100);
    t.check('"Pads in order from C1" maps note 40 to pad 5', /played Rim/.test(await win.textContent('.midi-last')), await win.textContent('.midi-last'));
    await win.evaluate(() => window.__fakeMidi.plug('Keyboard 2'));
    await sleep(100);
    const opts = await win.locator('select[aria-label="MIDI input"] option').allTextContents();
    t.check('a controller plugged in later shows up', opts.includes('Keyboard 2'), opts.join(', '));
    await win.selectOption('select[aria-label="MIDI input"]', 'Keyboard 2');
    await win.evaluate(() => window.__fakeMidi.send('Test Pads', [0x90, 37, 100]));
    await sleep(100);
    t.check('with one input chosen, other inputs are ignored', /played Rim/.test(await win.textContent('.midi-last')) && !/\(37\)/.test(await win.textContent('.midi-last')), await win.textContent('.midi-last'));
    await win.evaluate(() => window.__fakeMidi.send('Keyboard 2', [0x90, 37, 100]));
    await sleep(100);
    t.check('the chosen input plays', /\(37\) from Keyboard 2 played Sub Kick/.test(await win.textContent('.midi-last')), await win.textContent('.midi-last'));
    await win.selectOption('select[aria-label="MIDI input"]', '');

    // MIDI recording with velocity.
    await win.click('.modal button:has-text("Close")');
    await blur();
    await win.keyboard.press('r');
    await win.waitForFunction(() => window.__engine.isPlaying, null, { timeout: 5000 }).catch(() => {});
    await sleep(300);
    const mc = await win.evaluate(() => {
      const c = window.__engine.patternCycle();
      window.__fakeMidi.send('Test Pads', [0x90, 48, 64]); // pad 13 (Shaker) in pads-from-C1
      return c;
    });
    await sleep(100);
    await win.keyboard.press('Space');
    const ms = (await laneOf(12))[((Math.round(mc * 16) % 16) + 16) % 16];
    t.check('MIDI hits are recorded with their velocity', ms?.on && Math.abs(ms.velocity - 0.5) < 0.02, ms && `${ms.on} ${ms.velocity}`);

    // 6. Sound card.
    await win.click('button.settings-btn');
    const outs = await win.locator('select[aria-label="Sound output"] option').allTextContents();
    t.check('Settings lists the sound cards', outs.join('|') === 'System default|Studio Speakers|Headphones', outs.join('|'));
    await win.selectOption('select[aria-label="Sound output"]', 'hp-2');
    await sleep(200);
    t.check('choosing a sound card sends the sound there', (await win.evaluate(() => window.__sinkCalls.at(-1))) === 'hp-2', await win.evaluate(() => window.__sinkCalls.join()));
    await win.click('.modal button:has-text("Close")');
    await sleep(600); // settings are written as you go
    await closeApp(app, win);

    ({ app, win, pageErrors } = await launchApp(profile));
    await withFakes(win, [SPEAKERS, PHONES]);
    await sleep(300);
    t.check('the sound card is used again after a restart', (await win.evaluate(() => window.__sinkCalls.at(-1))) === 'hp-2', await win.evaluate(() => window.__sinkCalls.join()));
    await openTool(win, 'Pads');
    t.check('Keys play pads is remembered', await win.isChecked('.pads-head input[type=checkbox] >> nth=1'));
    await win.click('button.settings-btn');
    t.check('the MIDI note layout is remembered', (await win.inputValue('select[aria-label="MIDI notes"]')) === 'pads36');
    await win.click('.modal button:has-text("Close")');

    // Unplugged: the default plays, and the card is used again when it comes back.
    await withFakes(win, [SPEAKERS]);
    await win.click('button.settings-btn');
    const warn = await win.textContent('.settings .warn').catch(() => '');
    t.check('an unplugged sound card is reported and the default plays', warn.includes('Headphones is not connected') && (await win.evaluate(() => window.__engine.outputId)) === '', `${warn} / ${await win.evaluate(() => window.__engine.outputId)}`);
    await win.click('.modal button:has-text("Close")');
    await win.evaluate(() => {
      window.__fakeOutputs.push({ deviceId: 'hp-2', label: 'Headphones' });
      navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    });
    await sleep(300);
    t.check('plugging it back in uses it again', (await win.evaluate(() => window.__sinkCalls.at(-1))) === 'hp-2', await win.evaluate(() => window.__sinkCalls.join()));
    await win.click('button.settings-btn');
    await win.selectOption('select[aria-label="Sound output"]', '');
    await sleep(200);
    t.check('System default can be chosen again', (await win.evaluate(() => window.__sinkCalls.at(-1))) === '');
    await win.click('.modal button:has-text("Close")');

    // 7. Choosing each pad's key and MIDI note by hand.
    await openTool(win, 'Pads');
    const keyNote = async () => (await project()).tracks.map((x) => [x.key, x.note]);
    await win.click('.pads-head button:has-text("Set keys and notes")');
    t.check('"Set keys and notes" starts with the first pad', (await win.locator('.drum-pad.target').getAttribute('data-pad')) === '0' && (await win.isVisible('.assign-bar')));
    await win.click('.drum-pad[data-pad="2"]');
    t.check('clicking a pad picks it instead of playing it', (await win.locator('.drum-pad.target').getAttribute('data-pad')) === '2' && (await win.textContent('.assign-bar')).includes('Snare'), await win.textContent('.assign-bar'));
    await win.keyboard.press('q');
    t.check('pressing a key gives it to that pad', (await keyNote())[2][0] === 'q' && (await win.locator('.drum-pad[data-pad="2"] kbd').textContent()) === 'Q', JSON.stringify((await keyNote())[2]));
    t.check('then the next pad is picked', (await win.locator('.drum-pad.target').getAttribute('data-pad')) === '3');
    await win.evaluate(() => window.__fakeMidi.send('Test Pads', [0x90, 60, 100]));
    await sleep(100);
    t.check('hitting a controller pad gives its note to the picked pad', (await keyNote())[3][1] === 60 && (await win.locator('.drum-pad[data-pad="3"] .pad-note').textContent()) === 'C3', JSON.stringify((await keyNote())[3]));
    const wasPlaying = await win.evaluate(() => window.__engine.isPlaying);
    await win.keyboard.press('Space');
    t.check('a key that cannot play a pad says so and changes nothing', (await win.textContent('.toast').catch(() => '')).includes("can't play a pad") && (await win.evaluate(() => window.__engine.isPlaying)) === wasPlaying && (await keyNote())[4][0] === undefined, await win.textContent('.toast').catch(() => ''));
    await win.keyboard.press('Backspace');
    t.check('Backspace leaves the pad with no key and no note', JSON.stringify((await keyNote())[4]) === '["",-1]' && (await win.locator('.drum-pad[data-pad="4"] .pad-none').count()) === 2, JSON.stringify((await keyNote())[4]));
    await win.keyboard.press('Control+z');
    t.check('undo takes a choice back', (await keyNote())[4][0] === undefined, JSON.stringify((await keyNote())[4]));
    await win.click('.pads-head button:has-text("Done")');
    t.check('Done ends choosing', !(await win.isVisible('.assign-bar')) && !(await win.locator('.drum-pad.target').count()));
    await blur();
    await win.keyboard.press('q');
    const snareQ = await trackPeak(2);
    t.check('the chosen key plays its pad', snareQ > 0.01, snareQ.toFixed(3));
    await win.evaluate(() => window.__fakeMidi.send('Test Pads', [0x90, 60, 100]));
    const clap60 = await trackPeak(3);
    t.check('the chosen MIDI note plays its pad', clap60 > 0.01, clap60.toFixed(3));
    await win.keyboard.press('z');
    const kickZ = await trackPeak(0);
    t.check('pads left alone keep their usual key', kickZ > 0.01, kickZ.toFixed(3));
    await win.click('.pads-head button:has-text("Set keys and notes")');
    await win.click('.assign-bar button:has-text("Back to the usual layout")');
    t.check('"Back to the usual layout" forgets every choice', (await keyNote()).every(([k, n]) => k === undefined && n === undefined) && (await win.locator('.drum-pad[data-pad="2"] kbd').textContent()) === 'C');
    await win.keyboard.press('Escape');
    t.check('Escape ends choosing too', !(await win.isVisible('.assign-bar')));
    t.check('no page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
  } finally {
    await closeApp(app, win);
  }
}

await runStandalone(import.meta.url, 'Drum pads, recording, MIDI and sound card', run);

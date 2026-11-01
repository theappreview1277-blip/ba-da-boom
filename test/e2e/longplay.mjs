// Long playback: synth tracks (including the CPU-heavy supersaw) and the kit
// play for a minute. Notes must keep the same length bar after bar, the audio
// clock must keep up with real time, and the sound must still be there at the
// end. (Before the fix, superdough wrote each note's length back into a shared
// settings object, every bar's notes came out twice as long as the last, and
// after a few minutes the piled-up synths stopped the audio.)
import { closeApp, launchApp, runStandalone } from './lib.mjs';

const SECONDS = Number(process.env.BDB_LONGPLAY_SECONDS ?? 60);

export async function run(t) {
  const { app, win, pageErrors } = await launchApp();
  try {
    await win.evaluate(() => {
      // Record every supersaw voice superdough creates, to read its start and end.
      window.__saws = [];
      const Orig = window.AudioWorkletNode;
      window.AudioWorkletNode = class extends Orig {
        constructor(ac, name, opts) {
          super(ac, name, opts);
          if (name === 'supersaw-oscillator') window.__saws.push(this);
        }
      };
      const e = window.__engine;
      const p = structuredClone(e.project);
      const waves = ['supersaw', 'sawtooth', 'square', 'sine'];
      waves.forEach((wave, i) => Object.assign(p.tracks[i].sound, { source: 'synth', wave, note: 36 + i * 7, release: 0.1, lowpass: 3000, resonance: 5 }));
      p.metronome = true;
      e.update(p);
    });
    await win.keyboard.press('Space');
    const t0 = Date.now();
    const clock = [];
    while (Date.now() - t0 < SECONDS * 1000) {
      clock.push([Date.now() / 1000, await win.evaluate(() => window.__engine.ac.currentTime)]);
      await win.waitForTimeout(2500);
    }
    const peak = await win.evaluate(
      () =>
        new Promise((r) => {
          let max = 0;
          window.__engine.readMeters(16);
          const id = setInterval(() => {
            const m = window.__engine.readMeters(16);
            max = Math.max(max, m.left, m.right);
          }, 50);
          setTimeout(() => (clearInterval(id), r(max)), 2000);
        }),
    );
    await win.keyboard.press('Space');

    const lengths = await win.evaluate(() =>
      window.__saws.filter((n) => n.parameters.get('begin').value >= 0).map((n) => n.parameters.get('end').value - n.parameters.get('begin').value),
    );
    const first = lengths[0];
    const worst = lengths.reduce((m, l) => Math.max(m, Math.abs(l - first)), 0);
    t.check(
      `synth notes keep the same length for ${SECONDS} s of playback`,
      lengths.length > 20 && worst < 0.01,
      `${lengths.length} notes, first ${first?.toFixed(3)} s, largest difference ${worst.toFixed(3)} s`,
    );
    const a = clock[Math.max(0, clock.length - 7)];
    const b = clock[clock.length - 1];
    const speed = (b[1] - a[1]) / (b[0] - a[0]);
    t.check('the audio keeps up with real time to the end (no pile-up)', speed > 0.9, `${speed.toFixed(2)}× real time over the last ${(b[0] - a[0]).toFixed(0)} s`);
    t.check('there is still sound at the end', peak > 0.05, `peak ${peak.toFixed(2)}`);
    t.check('no errors in the page', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || 'none');
  } finally {
    await closeApp(app, win).catch(() => app.close());
  }
}

await runStandalone(import.meta.url, 'Long playback', run);

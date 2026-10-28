// Playback and editing through the real UI: play, edit while playing, quantised
// pattern switch, repeated transport presses, immediate stop, and WAV export.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeApp, launchApp, runStandalone, stubDialogs } from './lib.mjs';

export async function run(t) {
  const { app, win, profile, pageErrors } = await launchApp();
  try {
    const statuses = await win.evaluate(() => Object.fromEntries(window.__engine['status']));
    const notOk = Object.entries(statuses).filter(([, s]) => s !== 'ok');
    t.check('all factory samples load', notOk.length === 0, notOk.length ? notOk : `${Object.keys(statuses).length} samples`);

    await win.keyboard.press('Space');
    await win.waitForTimeout(1500);
    const cycle = await win.evaluate(() => window.__engine.audibleCycle());
    t.check('Space starts playback and the clock advances', cycle > 0.3, `cycle ${cycle?.toFixed(3)}`);
    t.check('play button shows Stop', (await win.textContent('.transport .play'))?.includes('Stop'));

    // Edit during playback; measure input-to-screen time.
    const ms = await win.evaluate(async () => {
      const cell = document.querySelector('[data-cell="t3:2"]');
      const t0 = performance.now();
      cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      while (!cell.classList.contains('on')) await new Promise((r) => requestAnimationFrame(r));
      return performance.now() - t0;
    });
    t.check('clicking a step while playing turns it on', true, `${ms.toFixed(1)} ms to screen`);
    t.check('step edit shows on screen within 100 ms', ms < 100, `${ms.toFixed(1)} ms`);
    t.note('stepEditToScreenMs', +ms.toFixed(1));

    // Pattern switch at the next bar, without stopping.
    const patterns = await win.evaluate(() => window.__engine['project'].patterns.map((p) => p.id));
    await win.keyboard.press('2');
    const queued = await win.evaluate(() => window.__engine.queued);
    t.check('pressing 2 queues pattern B for a bar line', queued?.patternId === patterns[1] && Number.isInteger(queued.atCycle), queued);
    await win.waitForFunction((id) => window.__engine.audiblePatternId === id, patterns[1], { timeout: 6000 }).catch(() => {});
    const after = await win.evaluate(() => ({ id: window.__engine.audiblePatternId, cycle: window.__engine.audibleCycle(), playing: window.__engine.isPlaying }));
    t.check('pattern B becomes audible at that bar and playback never stopped', after.id === patterns[1] && after.playing && after.cycle >= queued.atCycle, after);
    await win.keyboard.press('1');
    await win.waitForTimeout(2200);

    // Hammer the transport.
    for (let i = 0; i < 11; i++) {
      await win.keyboard.press('Space');
      await win.waitForTimeout(20 + ((i * 37) % 120));
    }
    await win.waitForTimeout(300);
    const s = await win.evaluate(() => window.__engine.isPlaying);
    t.check('11 rapid play/stop presses leave it stopped and responsive', s === false);
    await win.keyboard.press('Space');
    await win.waitForTimeout(800);
    t.check('it still plays after that', await win.evaluate(() => window.__engine.isPlaying && window.__engine.audibleCycle() > 0));

    // Immediate stop: master output must be silent within 60 ms.
    const tail = await win.evaluate(async () => {
      const e = window.__engine;
      const ac = e.ac;
      const an = ac.createAnalyser();
      an.fftSize = 2048;
      e['master'].input.connect(an);
      await e.stop();
      await new Promise((r) => setTimeout(r, 60));
      const buf = new Float32Array(2048);
      an.getFloatTimeDomainData(buf);
      return Math.max(...buf.map(Math.abs));
    });
    t.check('stop silences the output immediately (peak 60 ms after stop)', tail < 1e-4, tail.toExponential(2));

    // Export WAV through the UI.
    const wavPath = join(profile, 'export-test.wav');
    await stubDialogs(app, { savePath: wavPath });
    await win.keyboard.press('Control+e');
    await win.click('.modal button.primary');
    await win.waitForFunction(() => window.__lastExportInfo, null, { timeout: 60000 });
    const info = await win.evaluate(() => window.__lastExportInfo);
    t.check('export renders the expected 15 hits (starter beat + added snare)', info.events === 15, info.events);
    t.check('export includes the tail after the bar', info.seconds > info.musicalSeconds, `${info.seconds.toFixed(3)} s for ${info.musicalSeconds} s of music`);
    t.check('export peak is below full scale', info.peak > 0.05 && info.peak < 1, info.peak.toFixed(3));
    t.check('WAV file written', existsSync(wavPath));
    if (existsSync(wavPath)) {
      const b = readFileSync(wavPath);
      const ok = b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE' && b.readUInt16LE(22) === 2 && b.readUInt16LE(34) === 24;
      const frames = b.readUInt32LE(40) / 6;
      t.check('WAV is 24-bit stereo with the right length', ok && Math.abs(frames / b.readUInt32LE(24) - info.seconds) < 0.001, `${frames} frames @ ${b.readUInt32LE(24)} Hz`);
    }
    t.check('no errors in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
  } finally {
    await closeApp(app, win).catch(() => app.close());
  }
}

await runStandalone(import.meta.url, 'Playback, editing and export', run);

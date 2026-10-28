// Timing and reproducibility in the real app.
//  1. Offline export: onset positions vs the ideal grid.
//  2. Probability: same seed -> identical export, different seed -> different.
//  3. Real-time playback for LONG seconds (default 60) with a tempo change and
//     frequent edits: records the master bus and checks every click lands once, on the grid.
import { closeApp, launchApp, runStandalone, systemInfo } from './lib.mjs';

const LONG = Number(process.env.LONG ?? 60);
const EDITS = process.env.EDITS !== '0';

export async function run(t) {
  const { app, win, pageErrors } = await launchApp();
  try {
    t.note('system', await systemInfo(app));
    const r = {};
    // Helpers live in the page; each part runs in its own evaluate so a failure points at one part.
    await win.evaluate(() => {
      const { renderPattern, encodeWav24, parseProject, serializeProject } = window.__bdb;
      const base = parseProject(serializeProject(JSON.parse(JSON.stringify(window.__engine.project))));
      const clickProject = (bpm, seed = 1, prob = 1) => {
        const p = structuredClone(base);
        p.bpm = bpm;
        p.seed = seed;
        p.metronome = false;
        for (const pat of p.patterns) for (const lane of Object.values(pat.lanes)) lane.steps.forEach((s) => (s.on = false));
        const lane = p.patterns[0].lanes['t12'];
        // The metronome click: a 12 ms sine burst, easy to detect exactly.
        p.tracks[11].sound = { ...p.tracks[11].sound, sampleId: 'factory:metro-hi', release: 5 };
        lane.length = 16;
        lane.steps.forEach((s, i) => i < 16 && Object.assign(s, { on: true, velocity: 1, probability: prob }));
        p.currentPatternId = p.patterns[0].id;
        return p;
      };
      const onsets = (data, sr) => {
        const out = [];
        const win = Math.round(0.003 * sr);
        let lastLoud = -Infinity;
        for (let i = 0; i < data.length; i++) {
          if (Math.abs(data[i]) > 0.05) {
            if (i - lastLoud > win) out.push(i / sr);
            lastLoud = i;
          }
        }
        return out;
      };
      window.__timing = { renderPattern, encodeWav24, clickProject, onsets };
    });
    r.export = await win.evaluate(async () => {
      const { renderPattern, encodeWav24, clickProject, onsets } = window.__timing;
      const engine = window.__engine;
      const report = {};
      // 1. offline export timing
      {
        const bpm = 137;
        const p = clickProject(bpm);
        const res = await renderPattern(p, { patternId: p.patterns[0].id, bars: 4 });
        const sr = res.buffer.sampleRate;
        const on = onsets(res.buffer.getChannelData(0), sr);
        const stepDur = 60 / bpm / 4;
        // Relative to the first onset, so the detector's constant threshold delay cancels out.
        const errs = on.map((t, i) => Math.abs(t - on[0] - i * stepDur) * sr);
        report.exportFirst = on.slice(0, 4).map((t) => +(t * 1000).toFixed(3));
        report.export = { expected: 64, found: on.length, maxErrorSamples: Math.max(...errs), sampleRate: sr, events: res.events, seconds: res.buffer.duration };
      }
      return report.export;
    });
    const e = r.export;
    t.check('export: all 64 clicks found (4 bars at 137 BPM)', e.found === e.expected, `${e.found}/${e.expected}`);
    t.check('export: every click within 1 sample of the grid', e.maxErrorSamples <= 1, `max ${e.maxErrorSamples.toFixed(2)} samples @ ${e.sampleRate} Hz`);
    r.probability = await win.evaluate(async () => {
      const { renderPattern, encodeWav24, clickProject, onsets } = window.__timing;
      const engine = window.__engine;
      const report = {};
      // 2. reproducibility
      {
        const p = clickProject(120, 7, 0.5);
        const a = encodeWav24((await renderPattern(p, { patternId: p.patterns[0].id, bars: 4 })).buffer);
        const b = encodeWav24((await renderPattern(p, { patternId: p.patterns[0].id, bars: 4 })).buffer);
        const q = clickProject(120, 8, 0.5);
        const c = encodeWav24((await renderPattern(q, { patternId: q.patterns[0].id, bars: 4 })).buffer);
        const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
        const hits = async (proj) => onsets((await renderPattern(proj, { patternId: proj.patterns[0].id, bars: 4 })).buffer.getChannelData(0), 44100).length;
        report.probability = { sameSeedIdentical: same(a, b), otherSeedDiffers: !same(a, c), hitsSeed7: await hits(p), hitsSeed8: await hits(q), of: 64 };
      }
      return report.probability;
    });
    const p = r.probability;
    t.check('probability: same seed gives an identical WAV', p.sameSeedIdentical);
    t.check('probability: a different seed gives a different WAV', p.otherSeedDiffers);
    t.check('probability 50%: roughly half the hits play', [p.hitsSeed7, p.hitsSeed8].every((h) => h >= 16 && h <= 48), `${p.hitsSeed7} and ${p.hitsSeed8} of 64`);
    r.realtime = await win.evaluate(async ([LONG, EDITS]) => {
      const { renderPattern, encodeWav24, clickProject, onsets } = window.__timing;
      const engine = window.__engine;
      const report = {};
      // 3. real-time
      {
        const ac = engine.ac;
        const bpm1 = 128, bpm2 = 150;
        let p = clickProject(bpm1);
        engine.update(p);
        // Record the master bus with an AudioWorklet that tags each 128-frame block with
        // its frame position, so gaps in the capture itself would be detected, not mistaken for timing errors.
        const src = `class Rec extends AudioWorkletProcessor { process(inputs) { const ch = inputs[0][0]; if (ch) this.port.postMessage({ f: currentFrame, d: ch.slice(0) }); return true; } } registerProcessor('rec', Rec);`;
        await ac.audioWorklet.addModule('data:text/javascript,' + encodeURIComponent(src));
        const rec = new AudioWorkletNode(ac, 'rec', { numberOfInputs: 1, numberOfOutputs: 0 });
        const blocks = [];
        rec.port.onmessage = (e) => blocks.push(e.data);
        engine['master'].input.connect(rec);
        await engine.play();
        const t0 = performance.now();
        let edits = 0, tempoChangedAt = null;
        // Edits every ~0.7 s (rebuild the same musical content) plus one tempo change.
        while (performance.now() - t0 < LONG * 1000) {
          await new Promise((r) => setTimeout(r, 700));
          if (tempoChangedAt === null && performance.now() - t0 > (LONG * 1000) / 2) {
            p = { ...p, bpm: bpm2 };
            tempoChangedAt = engine.audibleCycle();
          } else p = { ...p };
          if (EDITS || p.bpm === bpm2) engine.update(p);
          edits++;
        }
        await engine.stop();
        await new Promise((r) => setTimeout(r, 300));
        engine['master'].input.disconnect(rec);
        const first = blocks[0].f;
        const last = blocks[blocks.length - 1].f + 128;
        const data = new Float32Array(last - first);
        let gaps = 0;
        const gapAt = [];
        for (let i = 0; i < blocks.length; i++) {
          if (i && blocks[i].f !== blocks[i - 1].f + 128) {
            gaps++;
            gapAt.push((blocks[i - 1].f + 128 - first) / ac.sampleRate);
          }
          data.set(blocks[i].d, blocks[i].f - first);
        }
        const on = onsets(data, ac.sampleRate);
        // Intervals that touch a capture gap can't be measured reliably; skip them.
        const nearGap = (a, b) => gapAt.some((g) => g >= a - 0.02 && g <= b + 0.02);
        const iv = on.slice(1).map((t, i) => (nearGap(on[i], t) ? null : t - on[i])).filter((d) => d !== null);
        const s1 = 60 / bpm1 / 4, s2 = 60 / bpm2 / 4;
        // Each interval must be one step at either tempo; one transition interval may sit in between.
        const bad = iv.filter((d) => Math.abs(d - s1) > 0.0005 && Math.abs(d - s2) > 0.0005);
        const dev1 = iv.filter((d) => Math.abs(d - s1) <= 0.0005).map((d) => Math.abs(d - s1) * ac.sampleRate);
        const dev2 = iv.filter((d) => Math.abs(d - s2) <= 0.0005).map((d) => Math.abs(d - s2) * ac.sampleRate);
        report.realtime = {
          seconds: LONG,
          captureGaps: gaps,
          intervalsSkippedNearGaps: on.length - 1 - iv.length,
          sampleRate: ac.sampleRate,
          baseLatencyMs: +(ac.baseLatency * 1000).toFixed(1),
          outputLatencyMs: +((ac.outputLatency || 0) * 1000).toFixed(1),
          onsets: on.length,
          edits,
          intervalsAtTempo1: dev1.length,
          intervalsAtTempo2: dev2.length,
          offGridIntervals: bad.map((d) => +(d * 1000).toFixed(2)),
          maxJitterSamples: Math.max(0, ...dev1, ...dev2),
          tempoChangedAtCycle: tempoChangedAt,
        };
      }
      return report.realtime;
    }, [LONG, EDITS]);
    const rt = r.realtime;
    const intervals = rt.onsets - 1;
    const measured = intervals - rt.intervalsSkippedNearGaps;
    t.check(`real time: ${rt.seconds} s of playback produced clicks`, rt.onsets > rt.seconds * 6, `${rt.onsets} clicks, ${rt.edits} edits during playback`);
    t.check('real time: at least 90% of intervals measurable (recorder gaps excluded)', measured >= intervals * 0.9, `${measured}/${intervals} measured, ${rt.captureGaps} recorder gaps`);
    t.check('real time: both tempos heard (128 then 150 BPM)', rt.intervalsAtTempo1 > 0 && rt.intervalsAtTempo2 > 0, `${rt.intervalsAtTempo1} at 128, ${rt.intervalsAtTempo2} at 150`);
    t.check('real time: no dropped, doubled or late clicks (only the tempo-change interval may differ)', rt.offGridIntervals.length <= 1, rt.offGridIntervals.length ? `off-grid ms: ${rt.offGridIntervals.join(', ')}` : 'none');
    t.check('real time: timing jitter at most 0.5 ms', rt.maxJitterSamples <= rt.sampleRate * 0.0005, `max ${rt.maxJitterSamples.toFixed(1)} samples @ ${rt.sampleRate} Hz`);
    t.note('realtime', r.realtime);
    t.note('export', r.export);
    t.check('no errors in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
  } finally {
    await closeApp(app, win).catch(() => app.close());
  }
}

await runStandalone(import.meta.url, 'Timing and reproducibility', run);

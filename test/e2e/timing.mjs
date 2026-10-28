// Timing and reproducibility checks, run in Chromium against the built renderer.
//  1. Offline export: onset positions vs the ideal grid.
//  2. Probability: same seed -> identical export, different seed -> different.
//  3. Real-time playback for LONG seconds with a tempo change and frequent edits:
//     records the master bus and checks every click lands once, on the grid.
// Usage: node test/e2e/timing.mjs  (expects `npx vite preview --port 4173`)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const LONG = Number(process.env.LONG ?? 60);
const EDITS = process.env.EDITS !== '0';
// ELECTRON_EXE=path\to\Ba-da-boom.exe runs the same checks inside the installed app.
const exe = process.env.ELECTRON_EXE;
let browser, page, electronApp;
if (exe) {
  const { _electron } = createRequire(import.meta.url)('playwright');
  // A separate profile, so the test also runs while the app is already open
  // (the app allows one instance per profile) and leaves the user's autosave alone.
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const profile = mkdtempSync(join(tmpdir(), 'bdb-timing-'));
  const extra = process.env.ELECTRON_ARGS ? process.env.ELECTRON_ARGS.split(' ') : [];
  electronApp = await _electron.launch({ executablePath: exe, args: [...extra, `--user-data-dir=${profile}`] });
  page = await electronApp.firstWindow();
} else {
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  page = await browser.newPage();
  await page.goto(process.env.URL ?? 'http://localhost:4173/');
}
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack));
await page.waitForFunction(() => window.__engine?.sampleStatus('factory:clave') === 'ok', null, { timeout: 20000 });

const result = await page.evaluate(async ([LONG, EDITS]) => {
  const { renderPattern, encodeWav24, parseProject, serializeProject } = window.__bdb;
  const engine = window.__engine;
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
  return report;
}, [LONG, EDITS]);
console.log(JSON.stringify(result, null, 2));
console.log('page errors:', errors.length, errors.slice(0, 2).join('\n---\n'));
if (electronApp) {
  const info = await electronApp.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged }));
  const os = await electronApp.evaluate(() => {
    const o = process.mainModule.require('os');
    return { platform: process.platform, release: process.getSystemVersion?.() ?? o.release(), cpu: o.cpus()[0]?.model, cores: o.cpus().length, memGB: +(o.totalmem() / 2 ** 30).toFixed(1) };
  });
  console.log('system:', JSON.stringify({ ...info, ...os }));
  await electronApp.evaluate(({ app }) => app.exit(0));
} else await browser.close();

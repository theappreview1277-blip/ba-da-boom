// The plugin's engine must sound like the app. Each case is a beat with one sound
// setting changed; the app renders it with its own WAV export (Strudel + superdough
// in Web Audio) and the plugin's C++ engine renders the same project's play model
// with bdb_render. The difference between the two must be at least 50 dB below the sound itself
// (measured: 58 to 91 dB below, about 88 dB for unfiltered samples).
//
// bdb_render comes from the plugin build: BDB_RENDER=<path>, or build-core/bdb_render
// next to the repository.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { closeApp, launchApp, newProfile, runStandalone } from './lib.mjs';

const REPO = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const RENDER =
  process.env.BDB_RENDER ??
  [join(REPO, '..', 'build-core', 'bdb_render'), join(REPO, 'plugin', 'build', 'bdb_render'), join(REPO, 'plugin', 'build', 'Release', 'bdb_render.exe')].find(existsSync);
// Export trims the tail where it falls below -80 dB. A filter's ringing can cross that
// line a few milliseconds apart in the two engines, so the lengths may differ by up to 20 ms.
const TAIL_FRAMES = 882;
const FACTORY = process.env.BDB_FACTORY ?? join(REPO, 'resources', 'samples');

// One setting each, on top of the base beat (track index -> sound patch).
const CASES = [
  ['the plain beat', {}],
  ['pitch up and down', { 0: { pitch: 7 }, 1: { pitch: -5 }, 2: { pitch: 12 } }],
  ['volume and pan', { 0: { volume: 0.6, pan: -0.8 }, 1: { volume: 1.3, pan: 0.5 }, 2: { pan: 1 } }],
  ['low-pass with resonance', { 0: { lowpass: 400, resonance: 8 }, 1: { lowpass: 1500 }, 2: { lowpass: 3000, resonance: 20 } }],
  ['high-pass', { 0: { highpass: 300 }, 1: { highpass: 1200, hpResonance: 6 }, 2: { highpass: 5000 } }],
  ['band-pass', { 0: { bandpass: 200, bandQ: 2 }, 1: { bandpass: 1000, bandQ: 8 }, 2: { bandpass: 4000, bandQ: 0.5 } }],
  ['24 dB filters', { 0: { lowpass: 600, filterType: '24db' }, 1: { highpass: 800, filterType: '24db' }, 2: { bandpass: 2000, bandQ: 3, filterType: '24db' } }],
  ['filter envelope', { 0: { lowpass: 200, filterEnv: 4, filterDecay: 0.2 }, 1: { lowpass: 3000, filterEnv: -3, filterDecay: 0.1 }, 2: { lowpass: 500, filterEnv: 6, filterDecay: 0.5, resonance: 10 } }],
  ['reverse', { 0: { reverse: true }, 1: { reverse: true, pitch: 3 } }],
  ['start and end', { 0: { start: 0.1, end: 0.6 }, 1: { start: 0.3 }, 2: { end: 0.2 } }],
  ['attack, decay and sustain', { 0: { attack: 0.02, decay: 0.1, sustain: 0.3 }, 1: { attack: 0.005 }, 2: { decay: 0.05, sustain: 0 } }],
  ['release', { 0: { release: 0.05 }, 1: { release: 0.3 }, 2: { release: 0.01, attack: 0.01 } }],
  ['choke groups', { 0: { choke: 1 }, 1: { choke: 1 }, 2: { choke: 2 }, 3: { choke: 2 } }],
  ['loud enough to hit the clipper', { 0: { volume: 1.5 }, 1: { volume: 1.5 }, 2: { volume: 1.5 }, 3: { volume: 1.5 } }],
];

function readFloatWav(path) {
  const b = readFileSync(path);
  let o = 12;
  while (o < b.length && b.toString('ascii', o, o + 4) !== 'data') o += 8 + b.readUInt32LE(o + 4);
  const n = b.readUInt32LE(o + 4) / 8;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = b.readFloatLE(o + 8 + i * 8);
    R[i] = b.readFloatLE(o + 12 + i * 8);
  }
  return [L, R];
}

const fromBase64 = (s) => {
  const buf = Buffer.from(s, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
};

/** Residual energy against the app's, in dB (lower is closer), per channel; the worse one. */
function residualDb(app, plug) {
  let worst = -Infinity;
  for (let c = 0; c < 2; c++) {
    const a = app[c], p = plug[c], n = Math.max(a.length, p.length);
    let sig = 0, res = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i] ?? 0, y = p[i] ?? 0;
      sig += x * x;
      res += (x - y) ** 2;
    }
    worst = Math.max(worst, 10 * Math.log10(res / Math.max(sig, 1e-20) + 1e-30));
  }
  return worst;
}

export async function run(t, { limitDb = Number(process.env.BDB_PARITY_DB ?? -50) } = {}) {
  t.check('the plugin renderer is built', !!RENDER && existsSync(RENDER), RENDER ?? 'not found (set BDB_RENDER)');
  if (!RENDER) return;
  const profile = newProfile();
  const { app, win, pageErrors } = await launchApp(profile);
  const dir = mkdtempSync(join(tmpdir(), 'bdb-parity-'));
  win.setDefaultTimeout(60000);
  try {
    await win.evaluate(() => {
      const { parseProject, serializeProject } = window.__bdb;
      const p = parseProject(serializeProject(structuredClone(window.__engine.project)));
      p.metronome = false;
      p.bpm = 128;
      p.swing = 58;
      const pat = p.patterns.find((x) => x.id === p.currentPatternId);
      // A busy beat on the first eight tracks: velocities, chance, timing and ratchets all in use.
      p.tracks.forEach((tr, ti) => {
        const lane = pat.lanes[tr.id];
        lane.steps.forEach((s, i) => {
          s.on = ti < 8 && (i * (ti + 3)) % (ti + 4) < 2;
          s.velocity = 0.4 + ((i * 7 + ti) % 6) / 10;
          s.probability = i % 5 === 3 ? 0.5 : 1;
          s.micro = i % 7 === 2 ? 0.2 : 0;
          s.ratchet = ti === 2 && i % 8 === 6 ? 3 : 1;
        });
      });
      window.__parityBase = p;
    });

    const runCase = async (name, patch, bars = 2) => {
      const got = await win.evaluate(
        async ([patch, bars]) => {
          const { renderPattern, playModel } = window.__bdb;
          const p = structuredClone(window.__parityBase);
          for (const [i, s] of Object.entries(patch)) p.tracks[i].sound = { ...p.tracks[i].sound, ...s };
          const r = await renderPattern(p, { patternId: p.currentPatternId, bars, missingSamples: new Set() });
          const b64 = (f) => {
            const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
            let s = '';
            for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
            return btoa(s);
          };
          const model = playModel(p);
          return { model, pattern: model.currentPattern, events: r.events, rate: r.buffer.sampleRate, ch: [0, 1].map((c) => b64(r.buffer.getChannelData(c))) };
        },
        [patch, bars],
      );
      const file = join(dir, `${CASES.findIndex((c) => c[0] === name)}`);
      writeFileSync(`${file}.json`, JSON.stringify(got.model));
      const out = spawnSync(RENDER, [`${file}.json`, FACTORY, join(profile, 'sample-pool'), String(got.pattern), String(bars), `${file}.wav`, String(got.rate)], { encoding: 'utf8' });
      if (out.status !== 0) return { error: out.stderr || `exit ${out.status}` };
      const info = JSON.parse(out.stdout.trim().split('\n').at(-1));
      const appCh = got.ch.map(fromBase64);
      const plugCh = readFloatWav(`${file}.wav`);
      return { db: residualDb(appCh, plugCh), events: [got.events, info.events], frames: [appCh[0].length, plugCh[0].length] };
    };

    for (const [name, patch] of CASES) {
      const r = await runCase(name, patch);
      const ok = !r.error && r.events[0] === r.events[1] && Math.abs(r.frames[0] - r.frames[1]) <= TAIL_FRAMES && r.db < limitDb;
      t.check(`sounds like the app: ${name}`, ok, r.error ?? `${r.db.toFixed(1)} dB, events ${r.events.join('/')}, frames ${r.frames.join('/')}`);
    }

    // The Acoustic Kit's stereo recordings, from the sample pool.
    await win.selectOption('select[aria-label=Kit]', 'AcousticKit');
    await win.waitForFunction(() => window.__lastKit?.kit === 'AcousticKit', null, { timeout: 30000 });
    await win.evaluate(() => {
      const p = window.__engine.project;
      Object.assign(window.__parityBase, { tracks: window.__parityBase.tracks.map((tr, i) => ({ ...tr, sound: { ...tr.sound, sampleId: p.tracks[i].sound.sampleId } })), samples: p.samples });
    });
    CASES.push(['the Acoustic Kit (stereo samples)', {}]);
    const r = await runCase('the Acoustic Kit (stereo samples)', { 0: { pitch: 2 }, 1: { lowpass: 2000 } });
    t.check('sounds like the app: the Acoustic Kit (stereo samples)', !r.error && r.events[0] === r.events[1] && Math.abs(r.frames[0] - r.frames[1]) <= TAIL_FRAMES && r.db < limitDb, r.error ?? `${r.db.toFixed(1)} dB, events ${r.events.join('/')}, frames ${r.frames.join('/')}`);
    t.check('no page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
  } finally {
    await closeApp(app, win);
  }
}

await runStandalone(import.meta.url, 'Plugin engine sounds like the app', run);

// The plugin's engine must sound like the app. Each case is a beat with one sound
// setting changed; the app renders it with its own WAV export (Strudel + superdough
// in Web Audio) and the plugin's C++ engine renders the same project's play model
// with bdb_render. The difference between the two must be at least 50 dB below the sound itself
// (measured: 58 to 91 dB below, about 88 dB for unfiltered samples).
//
// bdb_render comes from the plugin build: BDB_RENDER=<path>, or build-core/bdb_render
// next to the repository.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { closeApp, launchApp, newProfile, runStandalone } from './lib.mjs';

/** A short 16-bit mono WAV of a fading sine. */
function testWav(freq) {
  const n = 4410;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(44100, 24);
  buf.writeUInt32LE(88200, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / 44100) * 20000 * (1 - i / n)), 44 + i * 2);
  return buf;
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RENDER =
  process.env.BDB_RENDER ??
  [join(REPO, '..', 'build-core', 'bdb_render'), join(REPO, 'plugin', 'build', 'bdb_render'), join(REPO, 'plugin', 'build', 'Release', 'bdb_render.exe')].find(existsSync);
// Export trims the tail where it falls below -80 dB. A filter's ringing can cross that
// line a few milliseconds apart in the two engines, so the lengths may differ by up to 20 ms.
const TAIL_FRAMES = 882;
const HOST =
  process.env.BDB_HOST_TEST ??
  [
    join(REPO, '..', 'build-plugin', 'bdb_host_test_artefacts', 'Release', 'bdb_host_test'),
    join(REPO, 'plugin', 'build', 'bdb_host_test_artefacts', 'Release', 'bdb_host_test'),
    join(REPO, 'plugin', 'build', 'bdb_host_test_artefacts', 'Release', 'bdb_host_test.exe'),
  ].find(existsSync);
const VST3 =
  process.env.BDB_VST3 ??
  [join(REPO, '..', 'build-plugin', 'Badaboom_artefacts', 'Release', 'VST3', 'Ba-da-boom.vst3'), join(REPO, 'plugin', 'build', 'Badaboom_artefacts', 'Release', 'VST3', 'Ba-da-boom.vst3')].find(existsSync);
const STANDALONE =
  process.env.BDB_STANDALONE ??
  [join(REPO, '..', 'build-plugin', 'Badaboom_artefacts', 'Release', 'Standalone', 'Ba-da-boom'), join(REPO, 'plugin', 'build', 'Badaboom_artefacts', 'Release', 'Standalone', 'Ba-da-boom')].find(existsSync);
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
  ['vowels', { 0: { vowel: 'a' }, 1: { vowel: 'o' }, 2: { vowel: 'i' }, 3: { vowel: 'e' } }],
  ['coarse and crush', { 0: { coarse: 4 }, 1: { crush: 4 }, 2: { coarse: 8, crush: 6 } }],
  ['shape and drive', { 0: { shape: 0.6 }, 1: { drive: 2 }, 2: { shape: 0.95, drive: 0.5 } }],
  ['tremolo', { 0: { tremoloRate: 8, tremoloDepth: 0.8 }, 1: { tremoloRate: 3, tremoloDepth: 1 }, 2: { tremoloRate: 16, tremoloDepth: 0.4 } }],
  ['phaser', { 0: { phaserRate: 2, phaserDepth: 0.75 }, 1: { phaserRate: 0.5, phaserDepth: 0.3 }, 2: { phaserRate: 6, phaserDepth: 1 } }],
  ['synth waves', { 0: { source: 'synth', wave: 'sine', note: 36 }, 1: { source: 'synth', wave: 'square', note: 48 }, 2: { source: 'synth', wave: 'sawtooth', note: 60 }, 3: { source: 'synth', wave: 'triangle', note: 72 } }],
  ['synths with envelopes, filters and effects', { 0: { source: 'synth', wave: 'sawtooth', note: 40, pitch: 3, attack: 0.01, decay: 0.1, sustain: 0.4, release: 0.2, lowpass: 900, resonance: 6, filterEnv: 3, filterDecay: 0.15 }, 1: { source: 'synth', wave: 'square', note: 55, release: 0.05, shape: 0.5, phaserRate: 2 }, 2: { source: 'synth', wave: 'sine', note: 84, tremoloRate: 6, tremoloDepth: 0.7, pan: 0.6 } }],
  ['pulse', { 1: { source: 'synth', wave: 'pulse', note: 45 }, 2: { source: 'synth', wave: 'pulse', note: 69, release: 0.1, lowpass: 2500 } }],
  // The noises (and the kick's click) play the app's own noise buffers, handed to the renderer.
  ['the synth kick', { 0: { source: 'synth', wave: 'sbd' }, 3: { source: 'synth', wave: 'sbd', note: 33, decay: 0.2 } }],
  ['white, pink and brown noise', { 0: { source: 'synth', wave: 'white' }, 1: { source: 'synth', wave: 'pink', release: 0.2 }, 2: { source: 'synth', wave: 'brown', attack: 0.02, lowpass: 3000 } }],
  ['crackle', { 3: { source: 'synth', wave: 'crackle', release: 0.3 } }],
  // Its voices start at Math.random phases; the test gives the app's worklets the plugin's random numbers.
  ['supersaw', { 0: { source: 'synth', wave: 'supersaw', note: 48 }, 1: { source: 'synth', wave: 'supersaw', note: 60, release: 0.2, pan: 0.6 }, 3: { source: 'synth', wave: 'supersaw', note: 72, lowpass: 3000 } }],
  // Each track has its own delay and reverb (superdough's orbits).
  ['delay', { project: { delayTime: 0.3, delayFeedback: 0.6 }, 0: { delaySend: 0.5 }, 1: { delaySend: 0.3, pan: -0.7 }, 3: { delaySend: 1 } }],
  ['reverb', { 0: { reverbSend: 0.5 }, 2: { reverbSend: 0.3, pan: 0.6 }, 4: { reverbSend: 1 } }],
  ['delay and reverb with synths', { project: { delayTime: 0.21, delayFeedback: 0.8 }, 0: { source: 'synth', wave: 'sawtooth', note: 48, delaySend: 0.6, reverbSend: 0.4 }, 1: { reverbSend: 0.2, delaySend: 0.2, lowpass: 1200 } }],
  ['effects together', { 0: { lowpass: 2000, vowel: 'u', crush: 8, shape: 0.4, tremoloRate: 4, tremoloDepth: 0.5, phaserRate: 1 }, 1: { highpass: 400, drive: 1, coarse: 2, pan: -0.5 } }],
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
      // superdough makes each noise synth's 2-second buffer with Math.random (white, pink and brown
      // once, crackle for every sound). Note each one made, so the plugin's render can play the same.
      window.__noiseMade = [];
      window.__reverbMade = [];
      const make = BaseAudioContext.prototype.createBuffer;
      BaseAudioContext.prototype.createBuffer = function (channels, length, rate) {
        const b = make.call(this, channels, length, rate);
        if (channels === 1 && length === 2 * rate) window.__noiseMade.push(b);
        // reverbGen.mjs: the reverb's 3 seconds of decaying stereo noise (superdough's 2-second room).
        if (channels === 2 && length === Math.round(3 * rate)) window.__reverbMade.push(b);
        return b;
      };
      // The supersaw worklet starts its voices at Math.random phases. Seed them from each sound's start
      // time (its `begin` parameter) with splitmix64, as the renderer does with BDB_SAW_PHASES_FROM_START,
      // so the two can match sample for sample whatever order the worklets run in.
      const seeded = `{
        const M = (1n << 64n) - 1n;
        let s = 0n;
        Math.random = () => {
          s = (s + 0x9e3779b97f4a7c15n) & M;
          let z = s;
          z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M;
          z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M;
          z ^= z >> 31n;
          return Number(z >> 11n) / 2 ** 53;
        };
        const bits = new Uint32Array(1), asFloat = new Float32Array(bits.buffer);
        const register = globalThis.registerProcessor;
        globalThis.registerProcessor = (name, Processor) => {
          if (name !== 'supersaw-oscillator') return register(name, Processor);
          class Seeded extends Processor {
            // superdough also posts 'initialize' to each new node; if that lands after the first
            // quantum has drawn the phases they would be drawn again a quantum late. A new node
            // starts with no phases anyway, so only the constructor's call counts.
            initialize(options) {
              if (this.started) return;
              this.started = true;
              super.initialize(options);
            }
            process(inputs, outputs, params) {
              asFloat[0] = params.begin[0];
              s = 0x2545f4914f6cdd1dn ^ BigInt(bits[0]);
              return super.process(inputs, outputs, params);
            }
          }
          return register(name, Seeded);
        };
      }`;
      const addModule = AudioWorklet.prototype.addModule;
      const firsts = new WeakSet();
      AudioWorklet.prototype.addModule = async function (url, options) {
        if (!firsts.has(this)) {
          firsts.add(this);
          await addModule.call(this, `data:text/javascript,${encodeURIComponent(seeded)}`);
        }
        return addModule.call(this, url, options);
      };
      window.__parityFactory = structuredClone(p);
      window.__b64 = (f) => {
        const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
        let s = '';
        for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
        return btoa(s);
      };  // the factory kit, for the host test (its pool is the app's, not the test profile's)
    });

    // Make (and keep) the white, pink and brown buffers, one short render each.
    const noise = await win.evaluate(async () => {
      const { renderPattern } = window.__bdb;
      const out = [];
      for (const wave of ['white', 'pink', 'brown']) {
        const p = structuredClone(window.__parityBase);
        const pat = p.patterns.find((x) => x.id === p.currentPatternId);
        p.tracks.forEach((tr, i) => pat.lanes[tr.id].steps.forEach((st, j) => (st.on = i === 0 && j === 0)));
        p.tracks[0].sound = { ...p.tracks[0].sound, source: 'synth', wave };
        window.__noiseMade = [];
        await renderPattern(p, { patternId: p.currentPatternId, bars: 1, missingSamples: new Set() });
        out.push(window.__noiseMade.length === 1 ? window.__b64(window.__noiseMade[0].getChannelData(0)) : null);
      }
      return out;
    });
    t.check('the app made one buffer for each noise', noise.every(Boolean), noise.map((x) => (x ? 'made' : 'none')).join('/'));
    const noiseFiles = (to, crackles = [], reverbs = []) => {
      mkdirSync(to, { recursive: true });
      ['white', 'pink', 'brown'].forEach((type, i) => noise[i] && writeFileSync(join(to, `${type}.f32`), Buffer.from(noise[i], 'base64')));
      crackles.forEach((c, i) => writeFileSync(join(to, `crackle${i}.f32`), Buffer.from(c, 'base64')));
      reverbs.forEach((c, i) => writeFileSync(join(to, `reverb${i}.f32`), Buffer.from(c, 'base64')));
    };

    const runCase = async (name, patch, bars = 2) => {
      const got = await win.evaluate(
        async ([patch, bars]) => {
          const { renderPattern, playModel } = window.__bdb;
          const p = structuredClone(window.__parityBase);
          for (const [i, s] of Object.entries(patch)) {
            if (i === 'project') Object.assign(p, s);
            else p.tracks[i].sound = { ...p.tracks[i].sound, ...s };
          }
          window.__noiseMade = [];
          window.__reverbMade = [];
          const r = await renderPattern(p, { patternId: p.currentPatternId, bars, missingSamples: new Set() });
          const b64 = window.__b64;
          const model = playModel(p);
          const crackles = window.__noiseMade.map((b) => b64(b.getChannelData(0)));
          const reverbs = window.__reverbMade.map((b) => {
            const both = new Float32Array(2 * b.length);
            both.set(b.getChannelData(0));
            both.set(b.getChannelData(1), b.length);
            return b64(both);
          });
          return { model, pattern: model.currentPattern, events: r.events, rate: r.buffer.sampleRate, crackles, reverbs, ch: [0, 1].map((c) => b64(r.buffer.getChannelData(c))) };
        },
        [patch, bars],
      );
      const file = join(dir, `${CASES.findIndex((c) => c[0] === name)}`);
      noiseFiles(`${file}-noise`, got.crackles, got.reverbs);
      writeFileSync(`${file}.json`, JSON.stringify(got.model));
      const out = spawnSync(RENDER, [`${file}.json`, FACTORY, join(profile, 'sample-pool'), String(got.pattern), String(bars), `${file}.wav`, String(got.rate)], {
        encoding: 'utf8',
        env: { ...process.env, BDB_NOISE: `${file}-noise`, BDB_SAW_PHASES_FROM_START: '1' },
      });
      if (out.status !== 0) return { error: out.stderr || `exit ${out.status}` };
      const info = JSON.parse(out.stdout.trim().split('\n').at(-1));
      const appCh = got.ch.map(fromBase64);
      const plugCh = readFloatWav(`${file}.wav`);
      return { db: residualDb(appCh, plugCh), events: [got.events, info.events], frames: [appCh[0].length, plugCh[0].length] };
    };
    const only = process.env.BDB_PARITY_ONLY;

    for (const [name, patch] of CASES) {
      if (only && !new RegExp(only).test(name)) continue;
      const r = await runCase(name, patch);
      const ok = !r.error && r.events[0] === r.events[1] && Math.abs(r.frames[0] - r.frames[1]) <= TAIL_FRAMES && r.db < limitDb;
      t.check(`sounds like the app: ${name}`, ok, r.error ?? `${r.db.toFixed(1)} dB, events ${r.events.join('/')}, frames ${r.frames.join('/')}`);
    }
    // BDB_PARITY_ONLY=host: only the host and screen checks after the cases it names (none).
    if (only && only !== 'host') return;

    // The Acoustic Kit's stereo recordings, from the sample pool.
    if (!only) {
      await win.selectOption('select[aria-label=Kit]', 'AcousticKit');
      await win.waitForFunction(() => window.__lastKit?.kit === 'AcousticKit', null, { timeout: 30000 });
      await win.evaluate(() => {
        const p = window.__engine.project;
        Object.assign(window.__parityBase, { tracks: window.__parityBase.tracks.map((tr, i) => ({ ...tr, sound: { ...tr.sound, sampleId: p.tracks[i].sound.sampleId } })), samples: p.samples });
      });
      CASES.push(['the Acoustic Kit (stereo samples)', {}]);
      const r = await runCase('the Acoustic Kit (stereo samples)', { 0: { pitch: 2 }, 1: { lowpass: 2000 } });
      t.check('sounds like the app: the Acoustic Kit (stereo samples)', !r.error && r.events[0] === r.events[1] && Math.abs(r.frames[0] - r.frames[1]) <= TAIL_FRAMES && r.db < limitDb, r.error ?? `${r.db.toFixed(1)} dB, events ${r.events.join('/')}, frames ${r.frames.join('/')}`);
    }

    // --- The built VST3 in a host: state, transport, outputs, MIDI out, automation and its screen ---
    t.check('the VST3 and the test host are built', !!HOST && !!VST3, `${HOST ?? 'no host (set BDB_HOST_TEST)'} / ${VST3 ?? 'no VST3 (set BDB_VST3)'}`);
    if (HOST && VST3) {
      const got = await win.evaluate(async () => {
        const { renderPattern, playModel, serializeProject } = window.__bdb;
        const p = structuredClone(window.__parityFactory);
        const r = await renderPattern(p, { patternId: p.currentPatternId, bars: 2, missingSamples: new Set() });
        const b64 = (f) => {
          const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
          let s = '';
          for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
          return btoa(s);
        };
        const model = playModel(p);
        const hits = model.patterns[model.currentPattern].lanes.length;
        return { project: serializeProject(p), model: JSON.stringify(model), ch: [0, 1].map((c) => b64(r.buffer.getChannelData(c))), lanes: hits };
      });
      const hostDir = mkdtempSync(join(tmpdir(), 'bdb-host-'));
      writeFileSync(join(hostDir, 'project.txt'), got.project);
      writeFileSync(join(hostDir, 'model.json'), got.model);
      const reportFile = join(hostDir, 'screen.json');
      // What the screen's kits and sample folder checks use: an app install with only the TR-808
      // and the Acoustic Kit (other kits download), and a sample folder.
      const appRes = join(hostDir, 'app-resources');
      cpSync(join(REPO, 'resources', 'kits', 'RolandTR808'), join(appRes, 'kits', 'RolandTR808'), { recursive: true });
      cpSync(join(REPO, 'resources', 'acoustic'), join(appRes, 'acoustic'), { recursive: true });
      const sampleDir = join(hostDir, 'My Samples');
      const put = (rel, data) => {
        mkdirSync(join(sampleDir, rel, '..'), { recursive: true });
        writeFileSync(join(sampleDir, rel), data);
      };
      put('Kicks/Kick 01.wav', testWav(60));
      put('Snares/Snare A.wav', testWav(220));
      put('Fake.wav', 'this is not audio');
      put('readme.txt', 'not a sample');
      put('.hidden/Secret.wav', testWav(500));
      writeFileSync(join(hostDir, 'outside.wav'), testWav(330));
      // On Windows the plugin uses the real app folder: keep its settings as they were, and
      // forget the Casio download so it is downloaded again.
      const appDir = process.platform === 'win32' ? join(process.env.APPDATA ?? '', 'Ba-da-boom') : null;
      const keep = appDir ? [join(appDir, 'plugin-settings.json'), join(appDir, 'kits', 'CasioVL1.json')].map((f) => ({ f, text: existsSync(f) ? readFileSync(f) : null })) : [];
      for (const k of keep.slice(1)) rmSync(k.f, { force: true });
      const screenEnv = {
        BDB_PLUGIN_TEST_SCRIPT: join(REPO, 'test', 'e2e', 'plugin-screen.js'),
        BDB_PLUGIN_TEST_OUT: reportFile,
        BDB_PLUGIN_TRACE: '1',
        BDB_APP_RESOURCES: appRes,
        BDB_PLUGIN_TEST_FOLDER: sampleDir,
      };
      // On Windows the screen is opened inside the host. On Linux a JUCE host cannot drive a JUCE
      // plugin's web view (its scripts never return), so there the screen is checked in the
      // plugin's standalone build instead, with a silent sound device.
      const screenInHost = process.platform === 'win32';
      const out = spawnSync(HOST, screenInHost ? [VST3, hostDir, '--editor', '60'] : [VST3, hostDir], {
        encoding: 'utf8',
        timeout: 180000,
        env: { ...process.env, ...screenEnv },
      });
      if (!screenInHost) {
        t.check('the standalone build is there (for the screen check)', !!STANDALONE, STANDALONE ?? 'not found (set BDB_STANDALONE)');
        const home = mkdtempSync(join(tmpdir(), 'bdb-standalone-'));
        writeFileSync(join(home, '.asoundrc'), 'pcm.!default { type null }\nctl.!default { type hw card 0 }\n');
        spawnSync(STANDALONE, [], { timeout: 150000, env: { ...process.env, ...screenEnv, HOME: home } });
      }
      for (const k of keep) {
        if (k.text) writeFileSync(k.f, k.text);
        else if (k.f.endsWith('plugin-settings.json')) rmSync(k.f, { force: true });
      }
      const host = existsSync(join(hostDir, 'host.json')) ? JSON.parse(readFileSync(join(hostDir, 'host.json'), 'utf8')) : { error: out.stderr || `exit ${out.status}` };
      t.check('the host loads the plugin as an instrument', !host.error && host.name === 'Ba-da-boom' && host.isInstrument, host.error ?? host.name);
      t.check('all 17 stereo outputs can be switched on (the mix and one per track)', host.allOutputs === true && host.outputChannels === 34, `${host.allOutputs} ${host.outputChannels}`);
      t.check('it takes MIDI in and sends MIDI out', host.acceptsMidi && host.producesMidi);
      const app = got.ch.map(fromBase64).map((c) => c.subarray(0, host.frames));
      app.forEach((c, i) => writeFileSync(join(hostDir, `app-${i}.f32`), Buffer.from(c.buffer, c.byteOffset, c.byteLength)));  // for looking into a failure
      const plug = existsSync(join(hostDir, 'mix.wav')) ? readFloatWav(join(hostDir, 'mix.wav')) : [new Float32Array(), new Float32Array()];
      const db = residualDb(app, plug);
      t.check('played by the host transport, it sounds like the app', db < limitDb, `${db.toFixed(1)} dB over ${host.frames} frames`);
      const model = JSON.parse(got.model);
      const lane = (ti) => model.patterns[model.currentPattern].lanes[ti];
      let want = 0;
      for (let ti = 0; ti < model.tracks.length; ti++) {
        const l = lane(ti);
        if (!l || !model.tracks[ti].play || model.tracks[ti].note < 0) continue;
        // Steps that can't miss (chance 1) play once a bar for two bars; ratchets add hits.
        for (let k = 0; k < 2 * 16; k++) {
          const s = l.steps[k % l.length];
          if (s[0] && s[2] >= 1 && s[1] > 0) want += s[4];
        }
      }
      t.check('every hit goes out as a MIDI note, and each is let go', host.noteOns >= want && host.noteOns === host.noteOffs, `${host.noteOns} on, ${host.noteOffs} off, at least ${want}`);
      t.check('saved in the host project and loaded again, it plays the same', host.reloadResidualDb < -120 && host.projectKept, `${host.reloadResidualDb?.toFixed(1)} dB, project kept ${host.projectKept}`);
      t.check('added to a track with nothing saved, it plays the new-project beat', host.freshEnergy > 0.01, `rms ${host.freshEnergy}`);
      t.check('track 1 comes out of its own output, and the host can mute it', host.track1Energy > 0.001 && host.mutedTrack1Energy === 0, `${host.track1Energy} -> ${host.mutedTrack1Energy}`);
      // 4 + 16 mutes + 16 volumes, and the bypass switch every VST3 has.
      t.check('the host sees the volume, mute, song and pattern controls', host.parameters === 4 + 32 + 1, host.parameters);
      const screen = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : null;
      const c = screen?.checks ?? {};
      if (screen) console.log(`    screen report: ${JSON.stringify(screen)}`);
      t.check("the plugin's screen starts", (!screenInHost || host.editor) && c.screenStarted && c.pluginEngine === true, screen?.error ?? JSON.stringify(c).slice(0, 300));
      if (screenInHost) {
        t.check('the screen shows the project the host gave the plugin', c.bpmShown === JSON.parse(got.project).bpm && c.trackNames === JSON.parse(got.project).tracks.map((x) => x.name).join('|'), `${c.bpmShown} ${c.trackNames}`);
      } else {
        t.check('the screen shows its project and the plugin plays it', c.bpmShown === c.pluginBpm && c.trackNames?.startsWith('Kick|'), `${c.bpmShown} / ${c.pluginBpm}`);
      }
      t.check('Play on the screen previews the beat in the plugin, with the playhead and meters moving', c.playing && c.playheadDrawn > 0 && c.cycleMoved > 0.2 && c.metersMoved > 0.01 && c.stopped, JSON.stringify({ p: c.playing, h: c.playheadDrawn, c: c.cycleMoved, m: c.metersMoved, s: c.stopped }));
      t.check('the plugin answers the screen at once, even with a whole project', c.getStateMs < 250, `${c.getStateMs} ms`);
      t.check('the plugin reports what it plays to the screen, about 30 times a second', c.stateEvents >= 20, `${c.stateEvents} a second`);
      if (!(c.stateEvents >= 20)) {
        // The plugin's trace: how long its answers and files took, and how often its status timer ran.
        const appData = process.platform === 'win32' ? process.env.APPDATA : join(process.env.HOME ?? '', '.config');
        const log = join(appData ?? '', 'Ba-da-boom', 'logs', 'badaboom-plugin.log');
        if (existsSync(log)) console.log(readFileSync(log, 'utf8').split('\n').filter((l) => l.includes('trace:')).slice(-120).map((l) => `    ${l}`).join('\n'));
      }
      t.check("a step changed on the screen reaches the plugin and the host's project", c.stepNowOn === !c.stepWasOn && c.pluginStepOn === c.stepNowOn, `${c.stepWasOn} -> ${c.stepNowOn}; in the plugin: ${c.pluginStepOn}`);
      if (screenInHost) {
        const after = host.projectAfterEditor ? JSON.parse(host.projectAfterEditor) : null;
        const step = after?.patterns.find((x) => x.id === after.currentPatternId)?.lanes.t1?.steps[3];
        t.check("and the host saves it with its project", !!after && !!step?.on === c.stepNowOn, `${step?.on}`);
      }
      const kit = (k) => (k ? `${k.files} files, ${k.failed} failed, ${k.downloaded} downloaded, on ${k.assigned} tracks` : 'no result');
      t.check('the screen lists every kit the app has', c.kitCount >= 70, c.kitCount);
      t.check('a kit installed with the app loads in the plugin with no internet (TR-808, 122 files)', c.kit808?.files === 122 && c.kit808.failed === 0 && c.kit808.downloaded === 0 && c.kit808.assigned > 0, kit(c.kit808));
      t.check('and the plugin plays it: it has every sound, and keeps the kit in the host project', c.kitInPlugin === true && c.kit808Kept === c.kit808?.assigned, `${c.kitInPlugin} ${c.kit808Kept}`);
      t.check('the Acoustic Kit loads in the plugin', c.kitAcoustic?.files === 19 && c.kitAcoustic.failed === 0 && c.kitAcoustic.downloaded === 0, kit(c.kitAcoustic));
      t.check('a kit not installed downloads from GitHub, as in the app (Casio VL-1)', c.kitCasio?.files === 3 && c.kitCasio.failed === 0 && c.kitCasio.downloaded === 3, kit(c.kitCasio));
      t.check("loaded again, it comes from the app's kit cache, not the internet", c.kitCasioAgain?.files === 3 && c.kitCasioAgain.downloaded === 0, kit(c.kitCasioAgain));
      t.check('Add folder lists the sound files in it and its subfolders', c.folderFiles === 'Fake|Kicks/Kick 01|Snares/Snare A', c.folderFiles);
      t.check('double-clicking a folder file puts it on the track, from the sample pool', /^Kick 01 user [0-9a-f]{32}\.wav$/.test(c.folderAssigned ?? ''), c.folderAssigned);
      t.check('files outside the folder, and files that are not WAVs, are refused', /not in one of your sample folders/.test(c.folderOutside) && /not a WAV file/.test(c.folderFake), `${c.folderOutside} / ${c.folderFake}`);
      t.check("the screen's settings don't drop the folder", c.folderKept === '3', c.folderKept);
      const pooled = /([0-9a-f]{32}\.wav)$/.exec(c.folderAssigned ?? '')?.[1];
      const collected = pooled ? join(sampleDir, 'samples', pooled) : '';
      t.check('saving a project from the plugin puts its own samples next to it', c.savedNotCollected === 0 && existsSync(collected) && readFileSync(collected).equals(testWav(60)), `${c.savedNotCollected} not collected, ${existsSync(collected) ? 'collected' : 'missing'}`);
      t.check('no errors on the plugin screen', !c.pageErrors, c.pageErrors || 'none');
    }
    t.check('no page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
  } finally {
    await closeApp(app, win);
  }
}

await runStandalone(import.meta.url, 'Plugin engine sounds like the app', run);

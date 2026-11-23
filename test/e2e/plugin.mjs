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
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { closeApp, launchApp, newProfile, runStandalone } from './lib.mjs';

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
      window.__parityFactory = structuredClone(p);  // the factory kit, for the host test (its pool is the app's, not the test profile's)
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
      const screenEnv = { BDB_PLUGIN_TEST_SCRIPT: join(REPO, 'test', 'e2e', 'plugin-screen.js'), BDB_PLUGIN_TEST_OUT: reportFile };
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
        spawnSync(STANDALONE, [], { timeout: 90000, env: { ...process.env, ...screenEnv, HOME: home } });
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
      t.check('the plugin reports what it plays to the screen, about 30 times a second', c.stateEvents >= 20, `${c.stateEvents} a second`);
      t.check("a step changed on the screen reaches the plugin and the host's project", c.stepNowOn === !c.stepWasOn && c.pluginStepOn === c.stepNowOn, `${c.stepWasOn} -> ${c.stepNowOn}; in the plugin: ${c.pluginStepOn}`);
      if (screenInHost) {
        const after = host.projectAfterEditor ? JSON.parse(host.projectAfterEditor) : null;
        const step = after?.patterns.find((x) => x.id === after.currentPatternId)?.lanes.t1?.steps[3];
        t.check("and the host saves it with its project", !!after && !!step?.on === c.stepNowOn, `${step?.on}`);
      }
      t.check('no errors on the plugin screen', !c.pageErrors, c.pageErrors || 'none');
    }
    t.check('no page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
  } finally {
    await closeApp(app, win);
  }
}

await runStandalone(import.meta.url, 'Plugin engine sounds like the app', run);

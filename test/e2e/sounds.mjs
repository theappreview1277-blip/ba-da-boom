// Strudel's synths and effects in the real app: each setting is rendered with
// the same offline renderer as WAV export and must change the audio (and not
// be silent or broken); synth tracks play live; the inspector controls set them;
// and a project with all of them survives save and reopen.
import { join } from 'node:path';
import { closeApp, launchApp, newProfile, runStandalone, stubDialogs } from './lib.mjs';

export async function run(t) {
  const { app, win, pageErrors } = await launchApp();
  const consoleErrors = [];
  win.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  try {
    // --- Rendering: one hit on track 1, then each setting on its own ---
    await win.evaluate(() => {
      const { renderPattern, parseProject, serializeProject } = window.__bdb;
      const base = parseProject(serializeProject(JSON.parse(JSON.stringify(window.__engine.project))));
      base.metronome = false;
      for (const pat of base.patterns) for (const lane of Object.values(pat.lanes)) lane.steps.forEach((s) => (s.on = false));
      // A held note: the kick, half a second, on beats 1 and 3.
      const lane = base.patterns[0].lanes.t1;
      [0, 8].forEach((i) => Object.assign(lane.steps[i], { on: true, velocity: 1 }));
      base.currentPatternId = base.patterns[0].id;
      const stats = (buf) => {
        const d = buf.getChannelData(0);
        let peak = 0, sum = 0, early = 0, cross = 0, bad = false;
        const n = Math.min(d.length, Math.round(buf.sampleRate * 0.5));
        for (let i = 0; i < d.length; i++) {
          const v = d[i];
          if (!Number.isFinite(v)) bad = true;
          peak = Math.max(peak, Math.abs(v));
          sum += v * v;
          if (i < buf.sampleRate * 0.03) early += v * v;
          if (i > 0 && i < n && (d[i - 1] < 0) !== (v < 0)) cross++;
        }
        return { peak, rms: Math.sqrt(sum / d.length), early: Math.sqrt(early / (buf.sampleRate * 0.03)), zc: cross / 0.5, bad };
      };
      const render = async (patch) => {
        const p = structuredClone(base);
        p.tracks[0].sound = { ...p.tracks[0].sound, ...patch };
        const r = await renderPattern(p, { patternId: p.currentPatternId, bars: 1, missingSamples: new Set() });
        return { buf: r.buffer, ...stats(r.buffer) };
      };
      const diff = (a, b) => {
        const x = a.getChannelData(0), y = b.getChannelData(0);
        let s = 0;
        for (let i = 0; i < Math.min(x.length, y.length); i++) s += (x[i] - y[i]) ** 2;
        return Math.sqrt(s / x.length);
      };
      window.__snd = { render, diff };
    });
    const compare = (patch, against = {}) =>
      win.evaluate(
        async ([patch, against]) => {
          const { render, diff } = window.__snd;
          const a = await render(against);
          const b = await render(patch);
          return { peak: b.peak, rms: b.rms, early: b.early, zc: b.zc, bad: b.bad, basePeak: a.peak, baseEarly: a.early, baseZc: a.zc, diff: diff(a.buf, b.buf), rel: diff(a.buf, b.buf) / Math.max(1e-9, a.rms) };
        },
        [patch, against],
      );
    const fmt = (r) => `peak ${r.peak.toFixed(3)}, change ${(r.rel * 100).toFixed(0)}%`;
    const changes = (r, min = 0.05) => !r.bad && r.peak > 0.001 && r.rel > min;

    const rev = await compare({ reverse: true });
    t.check('Reverse plays the kick backwards (quiet start instead of the attack)', changes(rev) && rev.early < rev.baseEarly * 0.5, `start level ${rev.early.toFixed(3)} vs ${rev.baseEarly.toFixed(3)}`);

    const synths = {};
    for (const wave of ['sine', 'triangle', 'square', 'sawtooth', 'supersaw', 'pulse', 'white', 'pink', 'brown', 'crackle', 'sbd']) {
      synths[wave] = await compare({ source: 'synth', wave, note: 48, release: 0.1 });
    }
    const silent = Object.entries(synths).filter(([, r]) => r.bad || r.peak < 0.005).map(([w]) => w);
    t.check('every synth wave makes sound (sine, triangle, square, saw, supersaw, pulse, 4 noises, synth kick)', silent.length === 0, silent.length ? `silent: ${silent.join(', ')}` : Object.entries(synths).map(([w, r]) => `${w} ${r.peak.toFixed(2)}`).join(', '));
    const tones = ['sine', 'triangle', 'square', 'sawtooth'].map((w) => synths[w].rms.toFixed(4));
    t.check('the waves sound different from each other', new Set(tones).size === 4, tones.join(', '));
    const low = await compare({ source: 'synth', wave: 'sine', note: 36, release: 0.1 });
    const high = await compare({ source: 'synth', wave: 'sine', note: 60, release: 0.1 });
    t.check('a higher synth note is a higher pitch (two octaves up)', high.zc > low.zc * 3 && high.zc < low.zc * 5, `${low.zc.toFixed(0)} → ${high.zc.toFixed(0)} crossings/s`);
    const pitched = await compare({ source: 'synth', wave: 'sine', note: 36, pitch: 12, release: 0.1 });
    t.check('Pitch moves a synth too (+12 = one octave)', pitched.zc > low.zc * 1.6 && pitched.zc < low.zc * 2.4, `${low.zc.toFixed(0)} → ${pitched.zc.toFixed(0)}`);

    const saw = { source: 'synth', wave: 'sawtooth', note: 48, release: 0.1 };
    const checks = [
      ['Low-pass resonance', { ...saw, lowpass: 600, resonance: 20 }, { ...saw, lowpass: 600 }],
      ['24 dB filter', { ...saw, lowpass: 600, filterType: '24db' }, { ...saw, lowpass: 600 }],
      ['ladder filter', { ...saw, lowpass: 600, filterType: 'ladder' }, { ...saw, lowpass: 600 }],
      ['filter envelope', { ...saw, lowpass: 300, filterEnv: 5, filterDecay: 0.2 }, { ...saw, lowpass: 300 }],
      ['high-pass resonance', { ...saw, highpass: 800, hpResonance: 20 }, { ...saw, highpass: 800 }],
      ['band-pass', { ...saw, bandpass: 1200, bandQ: 8 }, saw],
      ['vowel', { ...saw, vowel: 'o' }, saw],
      ['decay and sustain', { ...saw, decay: 0.05, sustain: 0.1 }, saw],
      ['shape', { shape: 0.8 }, {}],
      ['bit crush', { crush: 3 }, {}],
      ['downsample', { ...saw, coarse: 16 }, saw],
      ['tremolo', { ...saw, release: 0.5, tremoloRate: 8, tremoloDepth: 1 }, { ...saw, release: 0.5 }],
      ['phaser', { ...saw, phaserRate: 2, phaserDepth: 0.9 }, saw],
    ];
    // superdough re-uses filter nodes from a pool; a node from one render (or
    // from live playback) must never be handed to another audio context.
    const again = await compare({ ...saw, highpass: 800, bandpass: 1200 }, { ...saw, highpass: 800, bandpass: 1200 });
    t.check('rendering the same filtered sound twice works and gives the same audio', !again.bad && again.peak > 0.001 && again.rel < 0.01, `difference ${(again.rel * 100).toFixed(2)}%`);
    const results = [];
    for (const [name, patch, against] of checks) results.push([name, await compare(patch, against)]);
    const unchanged = results.filter(([, r]) => !changes(r, 0.03));
    t.check(`each filter and effect changes the sound (${checks.length} settings)`, unchanged.length === 0, unchanged.length ? `no change: ${unchanged.map(([n, r]) => `${n} (${fmt(r)})`).join('; ')}` : results.map(([n, r]) => `${n} ${(r.rel * 100).toFixed(0)}%`).join(', '));

    // --- The inspector sets them ---
    const sound = () => win.evaluate(() => window.__engine['project'].tracks[0].sound);
    const pickSelect = (label, value) => win.selectOption(`.inspector select[aria-label="${label}"]`, value);
    await win.click('label:has-text("Reverse") input');
    let s = await sound();
    t.check('the Reverse box reverses the selected track', s.reverse === true);
    await win.click('label:has-text("Reverse") input');
    await win.click('.source-pick label:has-text("Synth") input');
    s = await sound();
    t.check('choosing Synth turns the track into a synth (sample settings hidden)', s.source === 'synth' && (await win.locator('.inspector .waveform, .inspector canvas').count()) === 0 && (await win.locator('.inspector select[aria-label=Wave]').count()) === 1);
    await pickSelect('Wave', 'supersaw');
    await pickSelect('Type', 'ladder');
    await pickSelect('Vowel', 'a');
    s = await sound();
    t.check('Wave, filter Type and Vowel menus set the sound', s.wave === 'supersaw' && s.filterType === 'ladder' && s.vowel === 'a', `${s.wave}, ${s.filterType}, ${s.vowel}`);
    const setSlider = async (label, value) => {
      await win.evaluate(
        ([label, value]) => {
          const row = [...document.querySelectorAll('.inspector .slider')].find((r) => r.querySelector('label')?.textContent === label);
          const input = row.querySelector('input[type=range]');
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          set.call(input, String(value));
          input.dispatchEvent(new Event('input', { bubbles: true }));
        },
        [label, value],
      );
    };
    await setSlider('Note', 60);
    await setSlider('Bit crush', 4);
    await setSlider('Downsample', 8);
    await setSlider('Tremolo', 5);
    await setSlider('Phaser', 1.5);
    await setSlider('Resonance', 10);
    await setSlider('Filter env', 3);
    await setSlider('Decay', 0.3);
    s = await sound();
    t.check('the new sliders set the sound (note, crush, downsample, tremolo, phaser, resonance, filter env, decay)', s.note === 60 && s.crush === 4 && s.coarse === 8 && s.tremoloRate === 5 && s.phaserRate === 1.5 && s.resonance === 10 && s.filterEnv === 3 && s.decay === 0.3, JSON.stringify({ note: s.note, crush: s.crush, coarse: s.coarse, tremolo: s.tremoloRate, phaser: s.phaserRate, res: s.resonance, env: s.filterEnv, decay: s.decay }));
    t.check('the note shows as a note name', (await win.textContent('.inspector .slider:has(label:text-is("Note")) output')) === 'C4');
    await setSlider('Bit crush', 17);
    t.check('Bit crush at the top is off', (await sound()).crush === 0 && (await win.textContent('.inspector .slider:has(label:text-is("Bit crush")) output')) === 'Off');

    // --- A synth track plays live (worklet synths in the live engine) ---
    await win.keyboard.press('Escape');
    await win.click('.grid .ruler');
    await win.keyboard.press('a');
    await win.keyboard.press('Space');
    const meter = await win.evaluate(() => {
      let max = 0;
      const el = document.querySelector('.row .meter-fill, .track-meter .meter-fill, .meter-fill');
      return new Promise((r) => {
        const id = setInterval(() => {
          const m = /scale[XY]\(([\d.]+)\)/.exec(el?.style.transform ?? '');
          if (m) max = Math.max(max, Number(m[1]));
        }, 20);
        setTimeout(() => (clearInterval(id), r(max)), 1500);
      });
    });
    await win.keyboard.press('Space');
    t.check('a synth track plays live (its meter moves)', meter > 0.05, meter.toFixed(2));

    // --- Save and reopen keeps it all ---
    const work = newProfile();
    await stubDialogs(app, { savePath: join(work, 'Synth.badaboom'), openPath: join(work, 'Synth', 'Synth.badaboom') });
    const before = JSON.stringify(await sound());
    await win.keyboard.press('Control+s');
    await win.waitForFunction(() => !document.querySelector('.statusbar')?.textContent?.includes('unsaved'), null, { timeout: 10000 }).catch(() => {});
    await pickSelect('Wave', 'sine');
    t.check('(a change after saving)', (await sound()).wave === 'sine');
    await win.keyboard.press('Control+o');
    await win.click('button:has-text("Don\'t save")');
    await win.waitForTimeout(1500);
    const after = await sound();
    t.check('save and reopen keeps every sound setting', JSON.stringify(after) === before && after.wave === 'supersaw', after.wave);
    t.check('no errors in the page or console', pageErrors.length === 0 && consoleErrors.length === 0, [...pageErrors, ...consoleErrors].slice(0, 3).join(' | ') || 'none');
  } finally {
    await closeApp(app, win).catch(() => app.close());
  }
}

await runStandalone(import.meta.url, 'Synths and effects', run);

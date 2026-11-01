import { describe, expect, it } from 'vitest';
import { defaultSound, newProject } from '../src/model/defaults';
import { parseProject, serializeProject } from '../src/model/serialize';
import { trackControls } from '../src/engine/strudel/fromModel';
import type { TrackSound } from '../src/model/types';

const withSound = (patch: Partial<TrackSound>) => {
  const p = newProject();
  p.tracks[0] = { ...p.tracks[0], sound: { ...p.tracks[0].sound, ...patch } };
  return { p, c: trackControls(p.tracks[0], 0, p) };
};

describe('sound controls sent to Strudel', () => {
  it('leaves every new effect off by default', () => {
    const { c } = withSound({});
    for (const k of ['ftype', 'resonance', 'lpenv', 'hresonance', 'bandf', 'vowel', 'shape', 'crush', 'coarse', 'tremolo', 'phaserrate', 'decay', 'note']) expect(c).not.toHaveProperty(k);
    expect(c.speed).toBe(1);
  });

  it('plays a reversed sample with a negative speed, keeping the pitch', () => {
    expect(withSound({ reverse: true }).c.speed).toBe(-1);
    expect(withSound({ reverse: true, pitch: 12 }).c.speed).toBe(-2);
  });

  it('turns a track into a synth: wave as the sound, note plus pitch, no sample settings', () => {
    const { c } = withSound({ source: 'synth', wave: 'sawtooth', note: 48, pitch: 2 });
    expect(c.s).toBe('sawtooth');
    expect(c.note).toBe(50);
    for (const k of ['speed', 'begin', 'end']) expect(c).not.toHaveProperty(k);
  });

  it('maps the filters', () => {
    expect(withSound({ lowpass: 800, resonance: 12, filterType: 'ladder' }).c).toMatchObject({ cutoff: 800, resonance: 12, ftype: 'ladder' });
    expect(withSound({ filterEnv: 3, filterDecay: 0.3 }).c).toMatchObject({ cutoff: 20000, lpenv: 3, lpdecay: 0.3, lpsustain: 0 });
    expect(withSound({ highpass: 300, hpResonance: 5 }).c).toMatchObject({ hcutoff: 300, hresonance: 5 });
    expect(withSound({ bandpass: 1000, bandQ: 4 }).c).toMatchObject({ bandf: 1000, bandq: 4 });
    expect(withSound({ vowel: 'o' }).c.vowel).toBe('o');
  });

  it('maps character, movement and envelope', () => {
    expect(withSound({ shape: 0.5, crush: 4, coarse: 8 }).c).toMatchObject({ shape: 0.5, crush: 4, coarse: 8 });
    expect(withSound({ tremoloRate: 6, tremoloDepth: 0.8, phaserRate: 2, phaserDepth: 0.4 }).c).toMatchObject({ tremolo: 6, tremolodepth: 0.8, phaserrate: 2, phaserdepth: 0.4 });
    expect(withSound({ decay: 0.2, sustain: 0.3 }).c).toMatchObject({ decay: 0.2, sustain: 0.3 });
  });
});

describe('project files with the new sound settings', () => {
  it('keep every setting through save and open', () => {
    const { p } = withSound({ source: 'synth', wave: 'supersaw', note: 60, reverse: true, decay: 0.4, sustain: 0.2, resonance: 9, hpResonance: 3, bandpass: 1500, bandQ: 6, filterType: '24db', filterEnv: -2, filterDecay: 0.5, vowel: 'e', shape: 0.3, crush: 6, coarse: 4, tremoloRate: 5, tremoloDepth: 0.7, phaserRate: 1.5, phaserDepth: 0.6 });
    const back = parseProject(serializeProject(p));
    expect(back.tracks[0].sound).toEqual(p.tracks[0].sound);
  });

  it('open format 3 projects with everything new switched off', () => {
    const old = JSON.parse(serializeProject(newProject()));
    old.version = 3;
    const keys = ['source', 'wave', 'note', 'reverse', 'decay', 'sustain', 'resonance', 'hpResonance', 'bandpass', 'bandQ', 'filterType', 'filterEnv', 'filterDecay', 'vowel', 'shape', 'crush', 'coarse', 'tremoloRate', 'tremoloDepth', 'phaserRate', 'phaserDepth'];
    for (const t of old.tracks) for (const k of keys) delete t.sound[k];
    const p = parseProject(JSON.stringify(old));
    const d = defaultSound(null);
    for (const t of p.tracks) for (const k of keys) expect(t.sound[k as keyof TrackSound]).toEqual(d[k as keyof TrackSound]);
    expect(p.tracks[0].sound.source).toBe('sample');
  });

  it('refuse unknown waves, filter types and vowels', () => {
    const raw = JSON.parse(serializeProject(newProject()));
    Object.assign(raw.tracks[0].sound, { wave: 'laser', filterType: 'moog', vowel: 'x', crush: 99, coarse: -3 });
    const s = parseProject(JSON.stringify(raw)).tracks[0].sound;
    expect([s.wave, s.filterType, s.vowel, s.crush, s.coarse]).toEqual(['sawtooth', '12db', '', 16, 1]);
  });
});

describe('note lengths stay the same bar after bar', () => {
  it('superdough writing value.duration back does not lengthen later notes', async () => {
    const { patternFromModel, cpsFromBpm } = await import('../src/engine/strudel/fromModel');
    const p = newProject();
    p.metronome = true;
    p.tracks[0].sound = { ...p.tracks[0].sound, source: 'synth', wave: 'supersaw' };
    const pat = patternFromModel(p, p.patterns[0], { metronome: true });
    const cps = cpsFromBpm(p.bpm);
    const lengths: number[] = [];
    for (let bar = 0; bar < 8; bar++) {
      for (const hap of pat.queryArc(bar, bar + 1)) {
        if (!hap.hasOnset()) continue;
        if (hap.value.orbit === 1) lengths.push(hap.duration.valueOf());
        // What superdough does with every value it plays:
        hap.value.duration = hap.duration.valueOf() / cps;
      }
    }
    expect(lengths.length).toBeGreaterThan(8);
    expect(new Set(lengths)).toEqual(new Set([lengths[0]]));
  });
});

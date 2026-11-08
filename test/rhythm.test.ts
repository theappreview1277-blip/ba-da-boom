import { describe, expect, it } from 'vitest';
import { newProject } from '../src/model/defaults';
import { currentPattern, setStep } from '../src/model/ops';
import {
  GENRES,
  ROLES,
  STYLES,
  addFillPattern,
  completeBeat,
  detectStyle,
  fillPattern,
  generateBeat,
  humanise,
  humaniseLane,
  renderPart,
  roleOf,
  roleTracks,
  styleById,
  unrollLane,
  type BeatOptions,
} from '../src/model/rhythm';
import type { Project } from '../src/model/types';
import { parseProject, serializeProject } from '../src/model/serialize';

const beat = (styleId: string, o: Partial<BeatOptions> = {}): BeatOptions => ({ styleId, complexity: 0.5, seed: 1, tempo: true, ...o });
const lane = (p: Project, trackId: string) => currentPattern(p).lanes[trackId];
const onsets = (p: Project, trackId: string) => {
  const l = lane(p, trackId);
  return l.steps.slice(0, l.length).flatMap((s, i) => (s.on ? [i] : []));
};
const grid = (p: Project, trackId: string) => {
  const l = lane(p, trackId);
  return l.steps.slice(0, l.length).map((s) => (s.on ? 'x' : '.')).join('');
};
// Factory track ids: t1 Kick, t3 Snare, t4 Clap, t5 Rim, t6 Closed Hat, t7 Open Hat, t8-10 toms, t14 Crash, t15 Ride.
const KICK = 't1';
const SNARE = 't3';
const CLAP = 't4';
const HAT = 't6';
const OPENHAT = 't7';

describe('beat library', () => {
  it('has many kinds of music, each part well formed', () => {
    expect(STYLES.length).toBeGreaterThanOrEqual(50);
    expect(GENRES.length).toBeGreaterThanOrEqual(14);
    expect(new Set(STYLES.map((s) => s.id)).size).toBe(STYLES.length);
    for (const s of STYLES) {
      expect(s.bpm, s.id).toBeGreaterThanOrEqual(60);
      expect(s.bpm, s.id).toBeLessThanOrEqual(200);
      expect(s.swing, s.id).toBeGreaterThanOrEqual(50);
      expect(s.swing, s.id).toBeLessThanOrEqual(75);
      expect(s.about.length, s.id).toBeGreaterThan(10);
      expect(s.parts.kick ?? s.parts.clave ?? s.parts.ride, `${s.id} has a foundation`).toBeTruthy();
      for (const [role, alts] of Object.entries(s.parts)) {
        expect(ROLES as readonly string[], `${s.id} role`).toContain(role);
        for (const part of alts!) {
          expect([16, 32, 64], `${s.id} ${role} length of ${part}`).toContain(part.length);
          expect(part, `${s.id} ${role}`).toMatch(/^[Xxogrt.]+$/);
        }
      }
    }
  });

  it('knows the drum & bass family', () => {
    const names = STYLES.filter((s) => s.genre === 'Drum & bass').map((s) => s.name);
    for (const n of ['Two-step', 'Step-fast / double kick', 'Halftime', 'Four-on-the-floor', 'Amen-style break', 'Think-style break', 'Apache-style break', 'Tramen-style break', 'Soul Pride-style break']) expect(names).toContain(n);
  });
});

describe('track roles', () => {
  it('reads the factory kit', () => {
    const p = newProject();
    expect(p.tracks.map((t) => roleOf(t, p))).toEqual(['kick', 'kick', 'snare', 'clap', 'rim', 'hat', 'openhat', 'tomlow', 'tommid', 'tomhigh', 'cowbell', 'clave', 'shaker', 'crash', 'ride', 'conga']);
    expect(roleTracks(p).kick).toBe('t1'); // the first kick wins, not the sub kick
  });

  it('reads renamed tracks and kit or imported sample names', () => {
    const p = newProject();
    const t = (name: string, sample = '') => {
      const tr = { ...p.tracks[0], name, sound: { ...p.tracks[0].sound, sampleId: 'user:x' } };
      return roleOf(tr, { samples: { 'user:x': { id: 'user:x', name: sample, source: 'user', file: 'x.wav' } } });
    };
    expect(t('BD 909')).toBe('kick');
    expect(t('HH')).toBe('hat');
    expect(t('OH')).toBe('openhat');
    expect(t('Hi Tom')).toBe('tomhigh');
    expect(t('Floor tom')).toBe('tomlow');
    expect(t('Track 1', 'Roland TR909 Closed Hat')).toBe('hat');
    expect(t('Track 1', 'Roland TR808 Open Hat 2')).toBe('openhat');
    expect(t('Track 1', 'Akai MPC60 Snare')).toBe('snare');
    expect(t('Track 1', 'my_kick_03')).toBe('kick');
    expect(t('Track 1', 'Tambourine')).toBe('shaker');
    expect(t('Pad', 'strings')).toBeNull();
  });
});

describe('beats in a style', () => {
  it('drum & bass two-step: kick on 1 and before 3, snare on 2 and 4', () => {
    const p = generateBeat(newProject(), beat('dnb-twostep', { complexity: 0, seed: 1 }));
    const k = onsets(p, KICK);
    expect(k.filter((i) => i % 16 === 0).length).toBeGreaterThan(0);
    expect(k.map((i) => i % 16)).toContain(10);
    expect(onsets(p, SNARE).map((i) => i % 16)).toEqual(expect.arrayContaining([4, 12]));
    expect(onsets(p, SNARE).every((i) => i % 16 === 4 || i % 16 === 12)).toBe(true);
    expect(p.bpm).toBe(174);
  });

  it('halftime: one snare per bar, on beat 3', () => {
    const p = generateBeat(newProject(), beat('dnb-halftime', { complexity: 0 }));
    expect(onsets(p, SNARE).map((i) => i % 16)).toEqual(Array(lane(p, SNARE).length / 16).fill(8));
  });

  it('four-on-the-floor: a kick on every beat', () => {
    const p = generateBeat(newProject(), beat('dnb-fourfloor'));
    expect(grid(p, KICK)).toBe('x...x...x...x...');
  });

  it('double kick: two kicks a 16th apart', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const k = onsets(generateBeat(newProject(), beat('dnb-doublekick', { seed })), KICK);
      expect(k.some((i) => k.includes(i + 1)), `seed ${seed}`).toBe(true);
    }
  });

  it('amen-style break is four bars with the broken third bar and a crash in the fourth', () => {
    const p = generateBeat(newProject(), beat('dnb-amen'));
    expect(lane(p, SNARE).length).toBe(64);
    expect(grid(p, SNARE).slice(32, 48)).not.toBe(grid(p, SNARE).slice(0, 16));
    expect(onsets(p, 't14')).toEqual([58]);
    expect(onsets(p, 't15').length).toBe(32);
  });

  it('every style writes a playable beat, the same for the same seed', () => {
    for (const s of STYLES) {
      const p = newProject();
      const a = generateBeat(p, beat(s.id, { seed: 9 }));
      const b = generateBeat(p, beat(s.id, { seed: 9 }));
      expect(JSON.stringify(a), s.id).toBe(JSON.stringify(b));
      const hits = a.tracks.reduce((n, t) => n + onsets(a, t.id).length, 0);
      expect(hits, s.id).toBeGreaterThan(4);
      expect(a.bpm).toBe(s.bpm);
      expect(a.swing).toBe(s.swing);
    }
  });

  it('complexity adds extra hits and ghost notes, never removes core hits', () => {
    for (const s of STYLES) {
      const lo = generateBeat(newProject(), beat(s.id, { complexity: 0, seed: 4 }));
      const hi = generateBeat(newProject(), beat(s.id, { complexity: 1, seed: 4 }));
      for (const t of lo.tracks) {
        const l = onsets(lo, t.id);
        const h = onsets(hi, t.id);
        // The open hat can take a closed-hat step at high complexity.
        if (t.id !== HAT) expect(l.every((i) => h.includes(i)), `${s.id} ${t.name}`).toBe(true);
      }
    }
  });

  it('trap hats roll (ratchets) at high complexity', () => {
    const p = generateBeat(newProject(), beat('trap', { complexity: 1 }));
    expect(lane(p, HAT).steps.some((s) => s.on && s.ratchet > 1)).toBe(true);
    const low = generateBeat(newProject(), beat('trap', { complexity: 0 }));
    expect(lane(low, HAT).steps.every((s) => s.ratchet === 1)).toBe(true);
  });

  it('jazz and shuffle swing their 8ths a triplet early', () => {
    const p = generateBeat(newProject(), beat('blues-shuffle'));
    const swung = lane(p, HAT).steps.filter((s, i) => s.on && i % 4 === 3);
    expect(swung.length).toBeGreaterThan(0);
    expect(swung.every((s) => s.micro === -0.33)).toBe(true);
  });

  it('closed and open hat never play the same step', () => {
    for (const s of STYLES)
      for (const seed of [1, 2, 3]) {
        const p = generateBeat(newProject(), beat(s.id, { complexity: 1, seed }));
        const o = new Set(onsets(p, OPENHAT));
        expect(onsets(p, HAT).filter((i) => o.has(i)), s.id).toEqual([]);
      }
  });

  it('clears tracks the style does not use, keeps locked steps, can leave the tempo alone', () => {
    let p = newProject();
    const pid = p.currentPatternId;
    p = setStep(p, pid, 't11', 3, { on: true, locked: true });
    p = setStep(p, pid, 't12', 5, { on: true });
    const out = generateBeat(p, beat('rock', { tempo: false }));
    expect(onsets(out, 't11')).toEqual([3]);
    expect(onsets(out, 't12')).toEqual([]);
    expect(out.bpm).toBe(120);
    expect(out.swing).toBe(50);
    expect(p.patterns[0].lanes.t12.steps[5].on).toBe(true); // input not mutated
  });

  it('uses a stand-in when the kit has no sound for a part', () => {
    const p = newProject();
    p.tracks[3] = { ...p.tracks[3], name: 'Bass' }; // no clap any more
    p.tracks[3].sound = { ...p.tracks[3].sound, sampleId: null };
    const out = generateBeat(p, beat('house-classic'));
    expect(onsets(out, SNARE).map((i) => i % 16)).toEqual(expect.arrayContaining([4, 12]));
  });
});

describe('complete my beat', () => {
  it('fills only the empty tracks, fitted to the pattern length', () => {
    let p = newProject(); // starter beat: kick, snare, closed hat
    const before = JSON.stringify([lane(p, KICK), lane(p, SNARE), lane(p, HAT)]);
    const { project, filled } = completeBeat(p, beat('house-classic'));
    expect(JSON.stringify([lane(project, KICK), lane(project, SNARE), lane(project, HAT)])).toBe(before);
    expect(filled).toContain(CLAP);
    // The starter's closed hat plays every 8th, so the offbeat open hat gives way to it.
    const ch = new Set(onsets(project, HAT));
    expect(onsets(project, OPENHAT).filter((i) => ch.has(i))).toEqual([]);
    expect(filled).not.toContain(KICK);
    expect(lane(project, CLAP).length).toBe(16);
    // A 32-step style part is cut to the pattern's one bar.
    p = completeBeat(newProject(), beat('hiphop-boombap')).project;
    for (const t of p.tracks) expect(lane(p, t.id).length).toBe(16);
  });

  it('reports nothing to do when every part is already written', () => {
    const full = generateBeat(newProject(), beat('rock', { complexity: 1 }));
    const r = completeBeat(full, beat('rock'));
    expect(r.filled).toEqual([]);
    expect(r.project).toBe(full);
  });
});

describe('style detection', () => {
  it('recognises each style from its own beat', () => {
    let top3 = 0;
    for (const s of STYLES) {
      const p = generateBeat(newProject(), beat(s.id, { seed: 3 }));
      const d = detectStyle(p);
      if (d.slice(0, 3).some((m) => m.style.id === s.id)) top3++;
      expect(d[0].score).toBeLessThanOrEqual(1);
    }
    expect(top3).toBe(STYLES.length);
  });

  it('a two-step DnB beat typed in by hand at 174 BPM reads as drum & bass', () => {
    let p = { ...newProject(), bpm: 174 };
    const pid = p.currentPatternId;
    for (const t of p.tracks) p = { ...p, patterns: p.patterns.map((pt) => ({ ...pt, lanes: { ...pt.lanes, [t.id]: { ...pt.lanes[t.id], steps: pt.lanes[t.id].steps.map((s) => ({ ...s, on: false })) } } })) };
    for (const i of [0, 10]) p = setStep(p, pid, KICK, i, { on: true });
    for (const i of [4, 12]) p = setStep(p, pid, SNARE, i, { on: true });
    expect(detectStyle(p)[0].style.genre).toBe('Drum & bass');
  });

  it('says nothing for an empty pattern', () => {
    const p = newProject();
    expect(detectStyle(p, p.patterns[1])).toEqual([]);
  });
});

describe('fills', () => {
  const base = () => generateBeat(newProject(), beat('pop', { complexity: 0, tempo: false })); // one bar

  it('a snare roll gets louder towards the end and rolls at high intensity', () => {
    const p = fillPattern(base(), { type: 'roll', steps: 4, intensity: 1, seed: 1 });
    const end = lane(p, SNARE).steps.slice(12, 16);
    expect(end.every((s) => s.on)).toBe(true);
    expect(end[3].velocity).toBeGreaterThan(end[0].velocity);
    expect(end[3].ratchet).toBeGreaterThan(1);
    // The rest of the bar is untouched.
    expect(lane(p, SNARE).steps.slice(0, 12)).toEqual(lane(base(), SNARE).steps.slice(0, 12));
  });

  it('a tom run goes from high to low', () => {
    const p = fillPattern(base(), { type: 'toms', steps: 8, intensity: 1, seed: 1 });
    const first = (id: string) => onsets(p, id).find((i) => i >= 8) ?? -1;
    expect(first('t10')).toBeGreaterThan(-1);
    expect(first('t10')).toBeLessThan(first('t9'));
    expect(first('t9')).toBeLessThan(first('t8'));
  });

  it('a drop out silences everything but a pickup snare', () => {
    const p = fillPattern(base(), { type: 'break', steps: 4, intensity: 0, seed: 1 });
    for (const t of p.tracks) {
      const tail = onsets(p, t.id).filter((i) => i >= 12);
      expect(tail, t.name).toEqual(t.id === SNARE ? [15] : []);
    }
  });

  it('keeps locked steps', () => {
    let p = base();
    p = setStep(p, p.currentPatternId, HAT, 14, { on: true, locked: true });
    const out = fillPattern(p, { type: 'roll', steps: 4, intensity: 1, seed: 2 });
    expect(lane(out, HAT).steps[14]).toMatchObject({ on: true, locked: true });
  });

  it('unrolls shorter lanes so they sound the same until the fill', () => {
    const l = unrollLane({ length: 4, steps: lane(newProject(), KICK).steps }, 16);
    expect(l.length).toBe(16);
    expect(l.steps.slice(0, 16).map((s) => s.on)).toEqual(Array(4).fill([true, false, false, false]).flat());
  });

  it('as a new pattern: a copy right after the current one, with the fill', () => {
    const p = base();
    const out = addFillPattern(p, { type: 'auto', steps: 8, intensity: 0.6, seed: 3 });
    expect(out.patterns.length).toBe(p.patterns.length + 1);
    expect(out.patterns[1].id).toBe(out.currentPatternId);
    expect(out.patterns[1].name).toBe('A fill');
    expect(JSON.stringify(out.patterns[0])).toBe(JSON.stringify(p.patterns[0]));
    expect(JSON.stringify(out.patterns[1].lanes)).not.toBe(JSON.stringify(p.patterns[0].lanes));
  });
});

describe('humanise', () => {
  const p0 = () => generateBeat(newProject(), beat('funk', { complexity: 1, tempo: false }));

  it('moves hits a little and varies velocity, within range, reproducibly', () => {
    const p = p0();
    const a = humanise(p, p.tracks.map((t) => t.id), { timing: 1, velocity: 1, feel: 'natural', seed: 5 });
    const b = humanise(p, p.tracks.map((t) => t.id), { timing: 1, velocity: 1, feel: 'natural', seed: 5 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const hits = a.tracks.flatMap((t) => lane(a, t.id).steps.filter((s) => s.on));
    expect(hits.some((s) => s.micro !== 0)).toBe(true);
    expect(hits.every((s) => Math.abs(s.micro) <= 0.12 && s.velocity >= 0.1 && s.velocity <= 1)).toBe(true);
  });

  it('timing is set, not added: applying twice gives the same timing', () => {
    const o = { timing: 0.8, velocity: 0, feel: 'natural' as const, seed: 2 };
    const ids = p0().tracks.map((t) => t.id);
    const once = humanise(p0(), ids, o);
    expect(once.tracks.some((t) => lane(once, t.id).steps.some((x) => x.on && x.micro !== 0))).toBe(true);
    const twice = humanise(once, ids, o);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('laid back puts snares late, pushed puts hats early, tight stays close to the grid', () => {
    const ids = p0().tracks.map((t) => t.id);
    const avg = (p: Project, id: string) => {
      const s = lane(p, id).steps.filter((x) => x.on);
      return s.reduce((n, x) => n + x.micro, 0) / s.length;
    };
    expect(avg(humanise(p0(), ids, { timing: 0.3, velocity: 0, feel: 'laidback', seed: 1 }), SNARE)).toBeGreaterThan(0.04);
    expect(avg(humanise(p0(), ids, { timing: 0.3, velocity: 0, feel: 'pushed', seed: 1 }), HAT)).toBeLessThan(-0.02);
    const tight = humanise(p0(), ids, { timing: 1, velocity: 0, feel: 'tight', seed: 1 });
    expect(lane(tight, HAT).steps.every((s) => Math.abs(s.micro) <= 0.031)).toBe(true);
  });

  it('leaves locked steps, rests and other tracks alone', () => {
    let p = p0();
    p = setStep(p, p.currentPatternId, SNARE, 4, { locked: true, micro: 0.2 });
    const out = humanise(p, [SNARE], { timing: 1, velocity: 1, feel: 'laidback', seed: 1 });
    expect(lane(out, SNARE).steps[4]).toEqual(lane(p, SNARE).steps[4]);
    expect(lane(out, KICK)).toBe(lane(p, KICK));
    const l = humaniseLane(lane(p, SNARE), 'snare', { timing: 1, velocity: 1, feel: 'natural', seed: 1 });
    l.steps.forEach((s, i) => !lane(p, SNARE).steps[i].on && expect(s).toEqual(lane(p, SNARE).steps[i]));
  });
});

describe('parts', () => {
  it('render with the right velocities: accents loud, ghosts soft', () => {
    const s = styleById('dnb-soulpride');
    const hits = renderPart(s, 'snare', 1, 1)!.filter(Boolean);
    const v = hits.map((h) => h!.velocity);
    expect(Math.max(...v)).toBeGreaterThan(0.85);
    expect(Math.min(...v)).toBeLessThan(0.45);
  });
});

describe('saving', () => {
  it('generated beats, fills and humanise survive save and open (no new file format needed)', () => {
    let p = generateBeat(newProject(), beat('blues-shuffle', { complexity: 1 }));
    p = fillPattern(p, { type: 'roll', steps: 4, intensity: 1, seed: 1 });
    p = humanise(p, [KICK, SNARE], { timing: 1, velocity: 1, feel: 'laidback', seed: 3 });
    const back = parseProject(serializeProject(p));
    expect(back.bpm).toBe(110);
    for (const t of p.tracks) expect(JSON.stringify(lane(back, t.id)), t.name).toBe(JSON.stringify(lane(p, t.id)));
  });
});

import { describe, expect, it } from 'vitest';
import { newProject } from '../src/model/defaults';
import { setLaneLength, setStep } from '../src/model/ops';
import { patternFromModel, soundKey } from '../src/engine/strudel/fromModel';
import type { Project } from '../src/model/types';

const onsets = (p: Project, begin: number, end: number) =>
  patternFromModel(p, p.patterns[0])
    .queryArc(begin, end)
    .filter((h) => h.hasOnset())
    .map((h) => ({ t: +h.whole!.begin.valueOf().toFixed(6), s: h.value.s as string, v: h.value.velocity as number }))
    .sort((a, b) => a.t - b.t || a.s.localeCompare(b.s));

function blank(): Project {
  const p = newProject();
  for (const lane of Object.values(p.patterns[0].lanes)) lane.steps.forEach((s) => (s.on = false));
  return p;
}

describe('patternFromModel', () => {
  it('places steps at 1/16 of a cycle with velocity', () => {
    let p = blank();
    p = setStep(p, p.patterns[0].id, 't1', 0, { on: true, velocity: 1 });
    p = setStep(p, p.patterns[0].id, 't1', 4, { on: true, velocity: 0.5 });
    expect(onsets(p, 0, 1)).toEqual([
      { t: 0, s: soundKey('factory:kick'), v: 1 },
      { t: 0.25, s: soundKey('factory:kick'), v: 0.5 },
    ]);
  });

  it('loops lanes of different lengths independently (polymeter)', () => {
    let p = blank();
    const id = p.patterns[0].id;
    p = setStep(p, id, 't1', 0, { on: true });
    p = setLaneLength(p, id, 't1', 3);
    const ts = onsets(p, 0, 1).map((o) => o.t);
    expect(ts).toEqual([0, 3 / 16, 6 / 16, 9 / 16, 12 / 16, 15 / 16].map((x) => +x.toFixed(6)));
  });

  it('applies ratchets, microtiming and swing', () => {
    let p = blank();
    const id = p.patterns[0].id;
    p = setStep(p, id, 't1', 0, { on: true, ratchet: 3 });
    p = setStep(p, id, 't3', 2, { on: true, micro: 0.25 });
    p = { ...p, swing: 75 };
    p = setStep(p, id, 't6', 1, { on: true });
    const ts = onsets(p, 0, 1);
    expect(ts.filter((o) => o.s === soundKey('factory:kick')).map((o) => o.t)).toEqual(
      [0, 1 / 48, 2 / 48].map((x) => +x.toFixed(6)),
    );
    expect(ts.find((o) => o.s === soundKey('factory:snare'))!.t).toBeCloseTo(2.25 / 16, 6);
    expect(ts.find((o) => o.s === soundKey('factory:hat-closed'))!.t).toBeCloseTo(1.5 / 16, 6);
  });

  it('early microtiming on step 0 lands at the end of the previous loop', () => {
    let p = blank();
    p = setStep(p, p.patterns[0].id, 't1', 0, { on: true, micro: -0.25 });
    expect(onsets(p, 0, 2).map((o) => o.t)).toEqual([+(1 - 0.25 / 16).toFixed(6), +(2 - 0.25 / 16).toFixed(6)]);
  });

  it('probability is reproducible for a seed and varies with the seed', () => {
    let p = blank();
    const id = p.patterns[0].id;
    for (let i = 0; i < 16; i++) p = setStep(p, id, 't6', i, { on: true, probability: 0.5 });
    const a = onsets(p, 0, 8).length;
    const b = onsets(p, 0, 8).length;
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(30);
    expect(a).toBeLessThan(98);
    const other = onsets({ ...p, seed: 99 }, 0, 8).map((o) => o.t).join();
    expect(other).not.toBe(onsets(p, 0, 8).map((o) => o.t).join());
  });

  it('mute and solo', () => {
    let p = newProject();
    p = { ...p, tracks: p.tracks.map((t) => (t.id === 't3' ? { ...t, solo: true } : t)) };
    expect(new Set(onsets(p, 0, 1).map((o) => o.s))).toEqual(new Set([soundKey('factory:snare')]));
    p = { ...p, tracks: p.tracks.map((t) => (t.id === 't3' ? { ...t, solo: false, mute: true } : t)) };
    expect(onsets(p, 0, 1).some((o) => o.s === soundKey('factory:snare'))).toBe(false);
  });
});

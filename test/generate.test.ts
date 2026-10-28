import { describe, expect, it } from 'vitest';
import { euclidSteps } from '../src/engine/strudel/generate';
import { pure } from '../src/engine/strudel/strudel';
import { emptyLane } from '../src/model/defaults';
import { applySteps, randomiseLane } from '../src/model/generate';

const onsetsOf = (pat: any, steps: number) =>
  pat
    .queryArc(0, 1)
    .filter((h: any) => h.hasOnset())
    .map((h: any) => Math.round(h.whole.begin.valueOf() * steps));

describe('Euclidean steps', () => {
  // Rotation is taken modulo the step count; the UI only offers 0..steps-1, the range where Strudel agrees.
  it('match Strudel euclidRot exactly', () => {
    for (const [k, n, r] of [[3, 8, 0], [3, 8, 2], [5, 16, 3], [7, 16, 14], [11, 24, 14], [0, 8, 0], [8, 8, 1]]) {
      const ours = euclidSteps(k, n, r).flatMap((b, i) => (b ? [i] : []));
      const theirs = onsetsOf((pure(1) as any).euclidRot(k, n, r), n);
      expect(ours, `${k},${n},${r}`).toEqual(theirs);
    }
  });
  it('the classic tresillo', () => {
    expect(euclidSteps(3, 8, 0).map((b) => (b ? 'x' : '.')).join('')).toBe('x..x..x.');
  });
  it('applySteps sets the length, keeps locked steps and step details', () => {
    const lane = emptyLane(16);
    lane.steps[1] = { ...lane.steps[1], on: true, velocity: 0.3, locked: true };
    lane.steps[3] = { ...lane.steps[3], velocity: 0.42 };
    const out = applySteps(lane, euclidSteps(3, 8, 0));
    expect(out.length).toBe(8);
    expect(out.steps[1].on).toBe(true); // locked, so not cleared
    expect(out.steps[3]).toMatchObject({ on: true, velocity: 0.42 });
    expect(out.steps.slice(0, 8).filter((s) => s.on).length).toBe(4);
  });
});

describe('randomise', () => {
  const base = () => {
    const l = emptyLane(16);
    for (const i of [0, 4, 8, 12]) l.steps[i] = { ...l.steps[i], on: true };
    l.steps[4].locked = true;
    return l;
  };
  it('is reproducible for a seed and differs between seeds', () => {
    const o = { strength: 1, density: 0.4 };
    expect(randomiseLane(base(), { ...o, seed: 5 })).toEqual(randomiseLane(base(), { ...o, seed: 5 }));
    expect(randomiseLane(base(), { ...o, seed: 5 })).not.toEqual(randomiseLane(base(), { ...o, seed: 6 }));
  });
  it('never touches locked steps or steps past the lane length', () => {
    for (let seed = 0; seed < 50; seed++) {
      const l = base();
      l.length = 12;
      l.steps[13].on = true;
      const out = randomiseLane(l, { seed, strength: 1, density: seed % 2 });
      expect(out.steps[4]).toEqual(l.steps[4]);
      expect(out.steps.slice(12)).toEqual(l.steps.slice(12));
    }
  });
  it('strength 0 changes nothing; strength 1 with density 0 clears every unlocked step', () => {
    expect(randomiseLane(base(), { seed: 1, strength: 0, density: 1 })).toEqual(base());
    const cleared = randomiseLane(base(), { seed: 1, strength: 1, density: 0 });
    expect(cleared.steps.filter((s) => s.on).map((s) => cleared.steps.indexOf(s))).toEqual([4]);
  });
  it('density sets roughly the share of hits', () => {
    const l = emptyLane(64);
    const out = randomiseLane(l, { seed: 9, strength: 1, density: 0.25 });
    const hits = out.steps.filter((s) => s.on).length;
    expect(hits).toBeGreaterThan(8);
    expect(hits).toBeLessThan(26);
  });
});

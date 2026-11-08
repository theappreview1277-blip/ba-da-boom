import { describe, expect, it } from 'vitest';
import { euclidSteps } from '../src/engine/strudel/generate';
import { pure } from '../src/engine/strudel/strudel';
import { emptyLane } from '../src/model/defaults';
import { applySteps, randomiseLane, varyLane } from '../src/model/generate';

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

describe('variations', () => {
  const groove = () => {
    const l = emptyLane(16);
    [0, 3, 6, 8, 10, 14].forEach((i, k) => (l.steps[i] = { ...l.steps[i], on: true, velocity: 0.5 + k * 0.08 }));
    l.steps[10].locked = true;
    return l;
  };
  const on = (l: ReturnType<typeof groove>) => l.steps.flatMap((s, i) => (s.on ? [i] : []));
  const base = { amount: 0.8, keepSkeleton: false, keepAccents: false, keepDensity: false };
  it('is reproducible and changes with the seed', () => {
    expect(varyLane(groove(), { ...base, seed: 3 })).toEqual(varyLane(groove(), { ...base, seed: 3 }));
    const outs = new Set([1, 2, 3, 4, 5].map((seed) => JSON.stringify(on(varyLane(groove(), { ...base, seed })))));
    expect(outs.size).toBeGreaterThan(2);
  });
  it('amount 0 changes nothing', () => {
    expect(varyLane(groove(), { ...base, amount: 0, seed: 1 })).toEqual(groove());
  });
  it('locked steps never change', () => {
    for (let seed = 0; seed < 40; seed++) expect(varyLane(groove(), { ...base, amount: 1, seed }).steps[10]).toEqual(groove().steps[10]);
  });
  it('keeping the skeleton keeps every on-beat hit', () => {
    for (let seed = 0; seed < 40; seed++) {
      const v = varyLane(groove(), { ...base, amount: 1, keepSkeleton: true, seed });
      expect(v.steps[0]).toEqual(groove().steps[0]);
      expect(v.steps[8]).toEqual(groove().steps[8]);
    }
  });
  it('keeping density keeps the number of hits; keeping accents keeps the velocities', () => {
    for (let seed = 0; seed < 40; seed++) {
      const v = varyLane(groove(), { ...base, amount: 1, keepDensity: true, keepAccents: true, seed });
      expect(on(v).length).toBe(6);
      const vels = (l: ReturnType<typeof groove>) => l.steps.filter((s) => s.on).map((s) => s.velocity).sort();
      expect(vels(v)).toEqual(vels(groove()));
    }
  });
  it('a moved hit keeps its step details', () => {
    const l = emptyLane(16);
    l.steps[5] = { ...l.steps[5], on: true, ratchet: 3, probability: 0.5 };
    const v = varyLane(l, { ...base, amount: 1, keepDensity: true, seed: 2 });
    const hit = v.steps.find((s) => s.on)!;
    expect(hit).toMatchObject({ ratchet: 3, probability: 0.5 });
  });
});

import { describe, expect, it } from 'vitest';
import { LiveSource, nextBar, nextStep } from '../src/engine/strudel/liveSource';
import { pure, stack } from '../src/engine/strudel/strudel';

const at = (p: any, b: number, e: number) =>
  p.queryArc(b, e).filter((h: any) => h.hasOnset()).map((h: any) => [+h.whole.begin.valueOf().toFixed(4), h.value.s]);

describe('LiveSource', () => {
  const a = pure({ s: 'a' }).fast(4); // quarter notes
  const b = pure({ s: 'b' }).fast(4);
  const offbeat = pure({ s: 'b' }).fast(4).late(0.125);

  it('switches exactly at the scheduled cycle, even when queried across it', () => {
    const live = new LiveSource(a);
    live.schedule(b, 2, 2);
    expect(at(live.pattern, 1.5, 2.5)).toEqual([[1.5, 'a'], [1.75, 'a'], [2, 'b'], [2.25, 'b']]);
  });

  it('a switch realigns the pattern; an edit keeps the current alignment', () => {
    const live = new LiveSource(a);
    const threeStep = stack(pure({ s: 'x' })).slow(3); // one hit every 3 cycles
    live.schedule(threeStep, 2, 2);
    expect(at(live.pattern, 2, 6)).toEqual([[2, 'x'], [5, 'x']]);
    live.schedule(pure({ s: 'y' }).slow(3), nextStep(3.1));
    expect(at(live.pattern, 2, 6)).toEqual([[2, 'x'], [5, 'y']]);
  });

  it('does not lose or duplicate events across many small queries', () => {
    const live = new LiveSource(a);
    live.schedule(offbeat, 1);
    const all: any[] = [];
    for (let t = 0; t < 2; t += 0.05) all.push(...at(live.pattern, t, Math.min(2, t + 0.05)));
    expect(all.map((x) => x[0])).toEqual([0, 0.25, 0.5, 0.75, 1.125, 1.375, 1.625, 1.875]);
  });

  it('boundary helpers', () => {
    expect(nextStep(0.0625)).toBe(0.0625);
    expect(nextStep(0.07)).toBe(0.125);
    expect(nextBar(3)).toBe(3);
    expect(nextBar(3.01)).toBe(4);
  });
});

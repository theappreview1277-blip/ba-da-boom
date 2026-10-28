import type { Lane } from './types';

// Seeded generators that write into the grid, so their results stay editable.
// The same seed and settings always give the same result.

/** Small, fast seeded PRNG (mulberry32). Returns numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RandomiseOptions {
  seed: number;
  /** 0..1: the share of (unlocked) steps that are re-rolled. 1 rewrites the whole lane. */
  strength: number;
  /** 0..1: chance that a re-rolled step is on. */
  density: number;
  /** Mixed into the seed so each track gets its own result from one seed. */
  salt?: number;
}

/** Re-roll unlocked steps inside the lane length. Locked steps are never touched. */
export function randomiseLane(lane: Lane, { seed, strength, density, salt = 0 }: RandomiseOptions): Lane {
  const rand = rng((seed * 1000003 + salt * 7919) >>> 0);
  const steps = lane.steps.map((s, i) => {
    // Draw the same numbers for every step, so changing strength or density
    // shifts the result smoothly instead of reshuffling everything.
    const pick = rand();
    const onRoll = rand();
    const velRoll = rand();
    if (i >= lane.length || s.locked || pick >= strength) return s;
    const on = onRoll < density;
    if (on === s.on) return s;
    return on ? { ...s, on, velocity: s.on ? s.velocity : +(0.55 + 0.45 * velRoll).toFixed(2) } : { ...s, on };
  });
  return { ...lane, steps };
}

/** Write an on/off pattern into a lane: sets the lane length, keeps locked steps and step details. */
export function applySteps(lane: Lane, bits: boolean[]): Lane {
  const steps = lane.steps.map((s, i) => (i >= bits.length || s.locked || s.on === bits[i] ? s : { ...s, on: bits[i] }));
  return { length: bits.length, steps };
}

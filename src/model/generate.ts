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

export interface VariationOptions {
  seed: number;
  /** 0..1: how much changes. */
  amount: number;
  /** Hits on the beat (every 4th step) stay where they are. */
  keepSkeleton: boolean;
  /** Hits keep their velocity; otherwise velocities are nudged. */
  keepAccents: boolean;
  /** The number of hits stays the same: hits move instead of appearing or disappearing. */
  keepDensity: boolean;
  salt?: number;
}

/**
 * A variation of a lane: some hits move to a neighbouring step, and (unless the
 * density is kept) some appear or disappear. Locked steps never change, and
 * neither do steps past the lane length.
 */
export function varyLane(lane: Lane, o: VariationOptions): Lane {
  const rand = rng((o.seed * 1000003 + (o.salt ?? 0) * 7919 + 17) >>> 0);
  const n = lane.length;
  const steps = lane.steps.slice();
  const fixed = (i: number) => steps[i].locked || (o.keepSkeleton && i % 4 === 0 && lane.steps[i].on);
  const nudge = (v: number) => {
    const d = (rand() - 0.5) * 0.4 * o.amount;
    return o.keepAccents || d === 0 ? v : Math.min(1, Math.max(0.2, +(v + d).toFixed(2)));
  };
  const hits = [...Array(n).keys()].filter((i) => lane.steps[i].on && !fixed(i));
  for (const i of hits) {
    const r = rand();
    const dirRoll = rand();
    if (r < o.amount * 0.6) {
      // Move to the nearest free neighbour, one or two steps away.
      const order = dirRoll < 0.5 ? [-1, 1, -2, 2] : [1, -1, 2, -2];
      const to = order.map((d) => (i + d + n) % n).find((j) => !steps[j].on && !fixed(j));
      if (to !== undefined) {
        steps[to] = { ...steps[to], on: true, velocity: nudge(steps[i].velocity), probability: steps[i].probability, micro: steps[i].micro, ratchet: steps[i].ratchet };
        steps[i] = { ...steps[i], on: false };
        continue;
      }
    } else if (!o.keepDensity && r < o.amount * 0.8) {
      steps[i] = { ...steps[i], on: false };
      continue;
    }
    steps[i] = { ...steps[i], velocity: nudge(steps[i].velocity) };
  }
  if (!o.keepDensity) {
    // Occasionally add a hit, more often near existing ones (ghost notes and pickups).
    for (let i = 0; i < n; i++) {
      const r = rand();
      const v = rand();
      if (steps[i].on || fixed(i) || lane.steps[i].on) continue;
      const nearHit = steps[(i + 1) % n].on || steps[(i + n - 1) % n].on;
      if (r < o.amount * (nearHit ? 0.15 : 0.05)) steps[i] = { ...steps[i], on: true, velocity: +(0.4 + 0.4 * v).toFixed(2) };
    }
  }
  return { ...lane, steps };
}

import { bjorklund, rotate } from './strudel';

/**
 * The same on/off pattern as Strudel's `euclidRot(pulses, steps, rotation)`:
 * `pulses` hits spread as evenly as possible over `steps`, rotated by `rotation`.
 */
export function euclidSteps(pulses: number, steps: number, rotation: number): boolean[] {
  const n = Math.max(1, Math.round(steps));
  const k = Math.max(0, Math.min(n, Math.round(pulses)));
  const bits = bjorklund(k, n).map(Boolean);
  const r = ((Math.round(rotation) % n) + n) % n;
  return r ? rotate(bits, -r) : bits;
}

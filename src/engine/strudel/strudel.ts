// Single import point for Strudel. The packages ship without TypeScript types,
// so the pieces we use are given minimal types here.
import * as core from '@strudel/core';

export interface StrudelPattern {
  query(state: unknown): StrudelHap[];
  queryArc(begin: number, end: number, controls?: Record<string, unknown>): StrudelHap[];
  degradeBy(amount: number): StrudelPattern;
  seed(n: number): StrudelPattern;
  ply(n: number): StrudelPattern;
  compress(b: number, e: number): StrudelPattern;
  late(cycles: number): StrudelPattern;
  early(cycles: number): StrudelPattern;
  slow(factor: number): StrudelPattern;
  fast(factor: number): StrudelPattern;
}

export interface StrudelHap {
  whole?: { begin: { valueOf(): number }; end: { valueOf(): number } };
  part: { begin: { valueOf(): number }; end: { valueOf(): number } };
  value: Record<string, unknown>;
  duration: { valueOf(): number };
  hasOnset(): boolean;
  context: Record<string, unknown>;
}

const c = core as unknown as Record<string, any>;
export const pure: (v: unknown) => StrudelPattern = c.pure;
export const stack: (...p: StrudelPattern[]) => StrudelPattern = c.stack;
export const silence: StrudelPattern = c.silence;
export const useRNG: (mode: string) => void = c.useRNG;
export const PatternClass: new (query: (state: any) => StrudelHap[]) => StrudelPattern = c.Pattern;
export const TimeSpan: any = c.TimeSpan;
export const Fraction: any = c.Fraction;

/** Strudel's Euclidean rhythm (Bjorklund's algorithm), as booleans. */
export const bjorklund: (pulses: number, steps: number) => boolean[] = c.bjorklund;
/** Strudel's array rotation, as used by `euclidRot`. */
export const rotate: <T>(arr: T[], n: number) => T[] = c.rotate;

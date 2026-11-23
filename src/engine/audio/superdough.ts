// Single import point for superdough (Strudel's audio engine), via @strudel/webaudio
// which re-exports it. Importing 'superdough' separately could load a second copy
// with its own global AudioContext, so everything goes through here.
import * as webaudio from '@strudel/webaudio';
import * as core from '@strudel/core';

const w = webaudio as unknown as Record<string, any>;
const c = core as unknown as Record<string, any>;

export const superdough: (value: Record<string, unknown>, t: number, duration: number, cps?: number, cycle?: number) => Promise<void> =
  w.superdough;
export const webaudioOutput: (...args: unknown[]) => Promise<void> = w.webaudioOutput;
export const initAudio: (opts?: { maxPolyphony?: number; disableWorklets?: boolean }) => Promise<void> = w.initAudio;
export const getAudioContext: () => BaseAudioContext = w.getAudioContext;
export const setAudioContext: (ctx: BaseAudioContext | null) => void = w.setAudioContext;
export const samples: (map: Record<string, string[]>, base?: string) => Promise<void> = w.samples;
export const loadBuffer: (url: string, ac: BaseAudioContext) => Promise<AudioBuffer> = w.loadBuffer;
export const setMaxPolyphony: (n: number) => void = w.setMaxPolyphony;
export const DEFAULT_MAX_POLYPHONY: number = w.DEFAULT_MAX_POLYPHONY;
export const getSuperdoughAudioController: () => SuperdoughController = w.getSuperdoughAudioController;
export const setSuperdoughAudioController: (c: SuperdoughController | null) => void = w.setSuperdoughAudioController;
export const resetGlobalEffects: () => void = w.resetGlobalEffects;
/** Registers superdough's oscillators, noises and synth kick (sine, sawtooth, supersaw, white, sbd, …). */
export const registerSynthSounds: () => void = w.registerSynthSounds;

// superdough's reverb (reverb.mjs) makes its impulse response in an OfflineAudioContext of its own
// and gives it to the ConvolverNode when that finishes, so for a moment the reverb is silent. Note
// each reverb made, so an export can wait for them instead of leaving the reverb out of its start.
const reverbs = new WeakMap<BaseAudioContext, ConvolverNode[]>();
if (typeof BaseAudioContext !== 'undefined') {
  const proto = BaseAudioContext.prototype as unknown as Record<string, (...args: unknown[]) => ConvolverNode>;
  const makeReverb = proto.createReverb;
  if (typeof makeReverb === 'function') {
    proto.createReverb = function (this: BaseAudioContext, ...args: unknown[]) {
      const node = makeReverb.apply(this, args);
      const list = reverbs.get(this) ?? [];
      list.push(node);
      reverbs.set(this, list);
      return node;
    };
  }
}

/** Resolves once every reverb made in `ctx` has its impulse response (or after `timeoutMs`). */
export async function reverbsReady(ctx: BaseAudioContext, timeoutMs = 5000): Promise<void> {
  const list = reverbs.get(ctx) ?? [];
  const until = Date.now() + timeoutMs;
  while (list.some((c) => !c.buffer) && Date.now() < until) await new Promise((r) => setTimeout(r, 5));
}

export const Cyclist: new (opts: Record<string, unknown>) => CyclistLike = c.Cyclist;
export const getTrigger: (opts: { getTime: () => number; defaultOutput: unknown }) => unknown = c.getTrigger;

export interface SuperdoughController {
  audioContext: BaseAudioContext;
  output: { destinationGain: GainNode | null; reset(): void };
  nodes: Record<string, { output: GainNode }>;
  reset(): void;
}

export interface CyclistLike {
  started: boolean;
  cps: number;
  lastEnd: number;
  latency: number;
  now(): number;
  start(): Promise<void>;
  stop(): void;
  setPattern(p: unknown, autostart?: boolean): Promise<void>;
  setCps(cps: number): void;
}

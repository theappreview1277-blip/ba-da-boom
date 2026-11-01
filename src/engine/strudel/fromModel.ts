// Generates Strudel patterns from the project model.
//
// Time convention: one Strudel cycle is one 4/4 bar of 16 steps, so
// cps = bpm / 240. A lane of length L loops every L/16 cycles, which is how
// independent track lengths (polymeters) fall out naturally.
//
// Only documented @strudel/core functions are used: pure, stack, silence,
// and the Pattern methods ply, degradeBy, seed, compress, late, slow.

import { pure, silence, stack, useRNG, type StrudelPattern } from './strudel';
import { RELEASE_FULL, STEPS_PER_BAR, type Lane, type Pattern, type Project, type Step, type Track } from '../../model/types';

// The 'precise' RNG hashes time and seed together, so different seeds give
// uncorrelated results. The legacy RNG only offsets time by the seed.
useRNG('precise');

export const METRONOME_ORBIT = 17;

/** Superdough sound name for a sample ref id. Sound names are lower-cased by superdough. */
export function soundKey(sampleId: string): string {
  return 'bdb_' + sampleId.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

export const cpsFromBpm = (bpm: number) => bpm / 60 / 4;

/** Swing delay in steps for a given step index. 50% = straight, 66.7% = triplet, 75% = dotted. */
export function swingOffset(stepIndex: number, swing: number): number {
  if (stepIndex % 2 === 0) return 0;
  return Math.max(0, Math.min(0.5, swing / 50 - 1));
}

/** Track sound settings as superdough control values. */
export function trackControls(track: Track, trackIndex: number, project: Project): Record<string, unknown> {
  const s = track.sound;
  const synth = s.source === 'synth';
  const v: Record<string, unknown> = {
    gain: s.volume,
    pan: (s.pan + 1) / 2,
    attack: s.attack,
    orbit: trackIndex + 1,
  };
  if (synth) {
    v.s = s.wave;
    v.note = s.note + s.pitch;
  } else {
    v.s = s.sampleId ? soundKey(s.sampleId) : undefined;
    // A negative speed plays the sample backwards.
    v.speed = Math.pow(2, s.pitch / 12) * (s.reverse ? -1 : 1);
    v.begin = Math.min(s.start, s.end - 0.001);
    v.end = Math.max(s.end, s.start + 0.001);
  }
  if (s.release < RELEASE_FULL) v.release = s.release;
  if (s.decay > 0) {
    v.decay = s.decay;
    v.sustain = s.sustain;
  }
  if (s.choke != null) v.cut = s.choke;
  if (s.filterType !== '12db') v.ftype = s.filterType;
  // The filter envelope moves the low-pass, so it needs a cutoff even when the low-pass is open.
  if (s.lowpass < 20000 || s.filterEnv !== 0) {
    v.cutoff = s.lowpass;
    if (s.resonance > 0) v.resonance = s.resonance;
    if (s.filterEnv !== 0) {
      v.lpenv = s.filterEnv;
      v.lpattack = 0.005;
      v.lpdecay = s.filterDecay;
      v.lpsustain = 0;
    }
  }
  if (s.highpass > 20) {
    v.hcutoff = s.highpass;
    if (s.hpResonance > 0) v.hresonance = s.hpResonance;
  }
  if (s.bandpass > 0) {
    v.bandf = s.bandpass;
    v.bandq = s.bandQ;
  }
  if (s.vowel) v.vowel = s.vowel;
  if (s.drive > 0) v.distort = s.drive;
  if (s.shape > 0) v.shape = s.shape;
  if (s.crush > 0) v.crush = s.crush;
  if (s.coarse > 1) v.coarse = s.coarse;
  if (s.tremoloRate > 0) {
    v.tremolo = s.tremoloRate;
    v.tremolodepth = s.tremoloDepth;
  }
  if (s.phaserRate > 0) {
    v.phaserrate = s.phaserRate;
    v.phaserdepth = s.phaserDepth;
  }
  if (s.delaySend > 0) {
    v.delay = s.delaySend;
    v.delaytime = project.delayTime;
    v.delayfeedback = project.delayFeedback;
  }
  if (s.reverbSend > 0) {
    v.room = s.reverbSend;
    v.roomsize = 2;
  }
  return v;
}

/** Whether a track makes sound at all: a synth, or a sample that is assigned. */
export const hasSound = (track: Track) => track.sound.source === 'synth' || !!track.sound.sampleId;

/** A per-step seed so that probability rolls on different steps and tracks are independent. */
export const stepSeed = (projectSeed: number, trackIndex: number, step: number) =>
  (projectSeed * 7919 + trackIndex * 131 + step) % 2147483647;

function stepPattern(step: Step, index: number, lane: Lane, controls: Record<string, unknown>, seed: number, swing: number) {
  let p: StrudelPattern = pure({ ...controls, velocity: step.velocity });
  if (step.probability < 1) p = p.degradeBy(1 - step.probability).seed(seed);
  if (step.ratchet > 1) p = p.ply(step.ratchet);
  const L = lane.length;
  p = p.compress(index / L, (index + 1) / L);
  const offset = step.micro + swingOffset(index, swing);
  if (offset !== 0) p = p.late(offset / L);
  return p;
}

/** The pattern for one lane, looping every lane.length steps. */
export function lanePattern(lane: Lane, track: Track, trackIndex: number, project: Project): StrudelPattern {
  if (!hasSound(track)) return silence;
  const controls = trackControls(track, trackIndex, project);
  const parts: StrudelPattern[] = [];
  for (let i = 0; i < lane.length; i++) {
    const step = lane.steps[i];
    if (!step.on) continue;
    parts.push(stepPattern(step, i, lane, controls, stepSeed(project.seed, trackIndex, i), project.swing));
  }
  if (parts.length === 0) return silence;
  return stack(...parts).slow(lane.length / STEPS_PER_BAR);
}

export function isAudible(track: Track, tracks: Track[]): boolean {
  if (track.mute) return false;
  const anySolo = tracks.some((t) => t.solo);
  return !anySolo || track.solo;
}

export interface BuildOptions {
  /** Sample ids that failed to load; their tracks are skipped instead of erroring. */
  missingSamples?: Set<string>;
  metronome?: boolean;
}

/**
 * Every hap gets its own copy of its controls. superdough writes the note length
 * into the value it is given (`value.duration = seconds`), and Strudel's
 * hap.duration reads value.duration back, so with one shared controls object
 * each bar's notes came out longer than the last (in seconds read as cycles):
 * synth notes and envelopes soon held forever and piled up until the audio stopped.
 */
const ownValues = (p: StrudelPattern) => p.withValue((v: Record<string, unknown>) => ({ ...v }));

/** The full Strudel pattern for one project pattern, starting at cycle 0. */
export function patternFromModel(project: Project, pattern: Pattern, opts: BuildOptions = {}): StrudelPattern {
  const parts: StrudelPattern[] = [];
  project.tracks.forEach((track, i) => {
    if (!isAudible(track, project.tracks)) return;
    if (track.sound.source === 'sample' && track.sound.sampleId && opts.missingSamples?.has(track.sound.sampleId)) return;
    const lane = pattern.lanes[track.id];
    if (lane) parts.push(lanePattern(lane, track, i, project));
  });
  if (opts.metronome) parts.push(metronomePattern());
  return parts.length ? ownValues(stack(...parts)) : silence;
}

export function metronomePattern(): StrudelPattern {
  const click = (key: string, gain: number) => pure({ s: soundKey(`factory:${key}`), gain, orbit: METRONOME_ORBIT });
  return ownValues(stack(
    click('metro-hi', 0.6).compress(0, 1 / 4),
    ...[1, 2, 3].map((beat) => click('metro-lo', 0.45).compress(beat / 4, (beat + 1) / 4)),
  ));
}

/** Readable Strudel code for a lane, shown in the code view. Not evaluated by the grid. */
export function laneToCode(lane: Lane, track: Track): string {
  const cells: string[] = [];
  for (let i = 0; i < lane.length; i++) {
    const st = lane.steps[i];
    if (!st.on) cells.push('~');
    else {
      let c = 'x';
      if (st.ratchet > 1) c = `x*${st.ratchet}`;
      if (st.probability < 1) c += `?${(1 - st.probability).toFixed(2)}`;
      cells.push(c);
    }
  }
  const sound = track.sound.source === 'synth' ? track.sound.wave : track.sound.sampleId ? soundKey(track.sound.sampleId) : '~';
  return `s("${cells.join(' ').replace(/x/g, sound)}").slow(${lane.length}/16)`;
}

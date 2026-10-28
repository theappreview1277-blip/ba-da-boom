// The project model is the single source of truth for everything the grid edits.
// Strudel patterns are generated from it (see src/engine/strudel); nothing in the
// audio engine or UI should hold musical state that is not represented here.

export const PROJECT_FORMAT = 'badaboom-project';
export const PROJECT_FORMAT_VERSION = 2;

export const MAX_STEPS = 64;
export const STEPS_PER_BAR = 16;
export const TRACK_COUNT = 16;
export const RELEASE_FULL = 5;

export interface Step {
  on: boolean;
  /** 0..1, multiplied into the track gain. */
  velocity: number;
  /** 0..1 chance that the step plays. Seeded, so playback and export agree. */
  probability: number;
  /** Timing offset as a fraction of one step, -0.5..0.5. */
  micro: number;
  /** Number of evenly spaced hits inside the step, 1..8. */
  ratchet: number;
  /** Locked steps are left alone by the generators (Euclidean, randomise). */
  locked: boolean;
}

export interface Lane {
  /** 1..MAX_STEPS. Lanes loop independently, which gives polymeters. */
  length: number;
  /** Always MAX_STEPS entries so shortening and re-lengthening a lane keeps data. */
  steps: Step[];
}

export interface TrackSound {
  sampleId: string | null;
  /** Linear gain, 0..1.5. */
  volume: number;
  /** -1 (left) .. 1 (right). */
  pan: number;
  /** Semitones, -24..24. Applied as playback speed. */
  pitch: number;
  /** Sample start/end as fractions of the sample, 0..1. */
  start: number;
  end: number;
  /** Seconds. */
  attack: number;
  /** Seconds after the step ends; RELEASE_FULL (5) means play the whole sample. */
  release: number;
  /** Tracks sharing a choke group cut each other off. null = no group. */
  choke: number | null;
  /** Low-pass cutoff in Hz; 20000 means off. */
  lowpass: number;
  /** High-pass cutoff in Hz; 20 means off. */
  highpass: number;
  /** 0..10, superdough `distort`. */
  drive: number;
  /** Send amounts 0..1. Delay time is per project for now. */
  delaySend: number;
  reverbSend: number;
}

export interface Track {
  id: string;
  name: string;
  mute: boolean;
  solo: boolean;
  sound: TrackSound;
}

export interface Pattern {
  id: string;
  name: string;
  /** Keyed by track id. */
  lanes: Record<string, Lane>;
}

export type SampleSource = 'factory' | 'user';

export interface SampleRef {
  id: string;
  name: string;
  source: SampleSource;
  /** Factory: file name in the factory folder. User: content hash file name in the pool / project samples folder. */
  file: string;
  /** Where a user sample was originally imported from, for information only. */
  originalName?: string;
}

export interface Project {
  format: typeof PROJECT_FORMAT;
  version: number;
  name: string;
  bpm: number;
  /** 50..75 (percent), MPC-style. 50 = straight, 66.7 = triplet feel. */
  swing: number;
  /** Seed for probability and randomisation; makes playback and export reproducible. */
  seed: number;
  masterVolume: number;
  delayTime: number;
  delayFeedback: number;
  metronome: boolean;
  tracks: Track[];
  patterns: Pattern[];
  currentPatternId: string;
  samples: Record<string, SampleRef>;
}

// The project model is the single source of truth for everything the grid edits.
// Strudel patterns are generated from it (see src/engine/strudel); nothing in the
// audio engine or UI should hold musical state that is not represented here.

export const PROJECT_FORMAT = 'badaboom-project';
export const PROJECT_FORMAT_VERSION = 4;

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

/** Superdough's built-in synth sounds (registerSynthSounds), plus its noise sources and synth kick. */
export const SYNTH_WAVES = ['sine', 'triangle', 'square', 'sawtooth', 'supersaw', 'pulse', 'white', 'pink', 'brown', 'crackle', 'sbd'] as const;
export type SynthWave = (typeof SYNTH_WAVES)[number];
export const FILTER_TYPES = ['12db', '24db', 'ladder'] as const;
export type FilterType = (typeof FILTER_TYPES)[number];
export const VOWELS = ['', 'a', 'e', 'i', 'o', 'u'] as const;
export type Vowel = (typeof VOWELS)[number];

export interface TrackSound {
  /** What makes the sound: the track's sample, or one of Strudel's synths. */
  source: 'sample' | 'synth';
  sampleId: string | null;
  /** Synth waveform (source 'synth'). */
  wave: SynthWave;
  /** Synth note, MIDI 24..96 (C1..C7); Pitch is added to it. */
  note: number;
  /** Play the sample backwards (negative speed). */
  reverse: boolean;
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
  /** Envelope decay in seconds (0 = none) and the level it decays to, 0..1. */
  decay: number;
  sustain: number;
  /** Tracks sharing a choke group cut each other off. null = no group. */
  choke: number | null;
  /** Low-pass cutoff in Hz; 20000 means off. */
  lowpass: number;
  /** Low-pass resonance (filter Q), 0..30; 0 leaves superdough's default. */
  resonance: number;
  /** High-pass cutoff in Hz; 20 means off. */
  highpass: number;
  hpResonance: number;
  /** Band-pass centre in Hz; 0 means off. */
  bandpass: number;
  /** Band-pass Q, 0.1..30. */
  bandQ: number;
  /** Filter model for all three filters: 12 dB, 24 dB (two in series) or ladder. */
  filterType: FilterType;
  /** Low-pass envelope depth in octaves, -8..8; 0 means off. */
  filterEnv: number;
  /** Low-pass envelope decay in seconds. */
  filterDecay: number;
  /** Formant filter; '' means off. */
  vowel: Vowel;
  /** Waveshaper, 0..0.95; 0 off. */
  shape: number;
  /** Bit crush depth in bits, 1..16; 0 off. */
  crush: number;
  /** Sample-rate reduction factor, 1 (off)..32. */
  coarse: number;
  /** Tremolo rate in Hz (0 off) and depth 0..1. */
  tremoloRate: number;
  tremoloDepth: number;
  /** Phaser rate in Hz (0 off) and depth 0..1. */
  phaserRate: number;
  phaserDepth: number;
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
  /** The computer key that plays this track's pad, chosen by hand. '' means none; unset uses the usual layout. */
  key?: string;
  /** The MIDI note that plays this track's pad, chosen by hand. -1 means none; unset uses the MIDI notes setting. */
  note?: number;
}

export interface Pattern {
  id: string;
  name: string;
  /** Keyed by track id. */
  lanes: Record<string, Lane>;
}

/** One block of the song arrangement: a pattern played for a number of bars. */
export interface SongEntry {
  patternId: string;
  /** 1..MAX_SONG_BARS. */
  bars: number;
}

export const MAX_SONG_BARS = 64;

export type SampleSource = 'factory' | 'user';

export interface SampleRef {
  id: string;
  name: string;
  source: SampleSource;
  /** Factory: file name in the factory folder. User: content hash file name in the pool / project samples folder. */
  file: string;
  /** Where a user sample was originally imported from, for information only. */
  originalName?: string;
  /** The Strudel drum machine kit a downloaded sample came from (groups it in the browser). */
  kit?: string;
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
  /** The arrangement, played in order in song mode and exported as one file. */
  song: SongEntry[];
  /** Song mode starts again from the top after the last entry. */
  songLoop: boolean;
  samples: Record<string, SampleRef>;
}

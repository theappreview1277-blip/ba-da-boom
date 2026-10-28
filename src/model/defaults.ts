import { FACTORY_SAMPLES, factorySampleRefs } from './factory';
import {
  MAX_STEPS,
  PROJECT_FORMAT,
  PROJECT_FORMAT_VERSION,
  STEPS_PER_BAR,
  TRACK_COUNT,
  type Lane,
  type Pattern,
  type Project,
  type Step,
  type Track,
  type TrackSound,
} from './types';

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function emptyStep(): Step {
  return { on: false, velocity: 0.8, probability: 1, micro: 0, ratchet: 1, locked: false };
}

export function emptyLane(length = STEPS_PER_BAR): Lane {
  return { length, steps: Array.from({ length: MAX_STEPS }, emptyStep) };
}

export function defaultSound(sampleId: string | null): TrackSound {
  return {
    sampleId,
    volume: 0.8,
    pan: 0,
    pitch: 0,
    start: 0,
    end: 1,
    attack: 0.001,
    release: 5,
    choke: null,
    lowpass: 20000,
    highpass: 20,
    drive: 0,
    delaySend: 0,
    reverbSend: 0,
  };
}

export function defaultTracks(): Track[] {
  return Array.from({ length: TRACK_COUNT }, (_, i) => {
    const f = FACTORY_SAMPLES[i % FACTORY_SAMPLES.length];
    const sound = defaultSound(`factory:${f.key}`);
    // Closed and open hats choke each other, as on most drum machines.
    if (f.key === 'hat-closed' || f.key === 'hat-open') sound.choke = 1;
    return { id: `t${i + 1}`, name: f.name, mute: false, solo: false, sound };
  });
}

export function emptyPattern(tracks: Track[], name: string): Pattern {
  const lanes: Record<string, Lane> = {};
  for (const t of tracks) lanes[t.id] = emptyLane();
  return { id: newId('p'), name, lanes };
}

function setSteps(lane: Lane, indices: number[], velocity = 0.8) {
  for (const i of indices) lane.steps[i] = { ...lane.steps[i], on: true, velocity };
}

export function newProject(): Project {
  const tracks = defaultTracks();
  const a = emptyPattern(tracks, 'A');
  // A simple starter beat so the first press of Play makes music.
  setSteps(a.lanes.t1, [0, 4, 8, 12], 0.95);
  setSteps(a.lanes.t3, [4, 12], 0.85);
  setSteps(a.lanes.t6, [0, 2, 4, 6, 8, 10, 12, 14], 0.6);
  setSteps(a.lanes.t6, [2, 6, 10, 14], 0.45);
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_FORMAT_VERSION,
    name: 'Untitled',
    bpm: 120,
    swing: 50,
    seed: 1,
    masterVolume: 0.8,
    delayTime: 0.375,
    delayFeedback: 0.35,
    metronome: false,
    tracks,
    patterns: [a, emptyPattern(tracks, 'B'), emptyPattern(tracks, 'C'), emptyPattern(tracks, 'D')],
    currentPatternId: a.id,
    samples: factorySampleRefs(),
  };
}

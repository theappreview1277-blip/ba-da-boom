import { defaultSound, emptyLane, emptyStep } from './defaults';
import { factorySampleRefs } from './factory';
import {
  MAX_STEPS,
  PROJECT_FORMAT,
  PROJECT_FORMAT_VERSION,
  type Lane,
  type Pattern,
  type Project,
  type SampleRef,
  type Step,
  type Track,
  type TrackSound,
} from './types';

export class ProjectFormatError extends Error {}

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
};
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function readStep(v: unknown): Step {
  const s = obj(v);
  const d = emptyStep();
  return {
    on: bool(s.on, d.on),
    velocity: clamp(s.velocity, 0, 1, d.velocity),
    probability: clamp(s.probability, 0, 1, d.probability),
    micro: clamp(s.micro, -0.5, 0.5, d.micro),
    ratchet: Math.round(clamp(s.ratchet, 1, 8, d.ratchet)),
    locked: bool(s.locked, d.locked),
  };
}

function readLane(v: unknown): Lane {
  const l = obj(v);
  const lane = emptyLane(Math.round(clamp(l.length, 1, MAX_STEPS, 16)));
  if (Array.isArray(l.steps)) {
    for (let i = 0; i < Math.min(MAX_STEPS, l.steps.length); i++) lane.steps[i] = readStep(l.steps[i]);
  }
  return lane;
}

function readSound(v: unknown): TrackSound {
  const s = obj(v);
  const d = defaultSound(null);
  return {
    sampleId: typeof s.sampleId === 'string' ? s.sampleId : null,
    volume: clamp(s.volume, 0, 1.5, d.volume),
    pan: clamp(s.pan, -1, 1, d.pan),
    pitch: clamp(s.pitch, -24, 24, d.pitch),
    start: clamp(s.start, 0, 1, d.start),
    end: clamp(s.end, 0, 1, d.end),
    attack: clamp(s.attack, 0, 2, d.attack),
    release: clamp(s.release, 0, 5, d.release),
    choke: typeof s.choke === 'number' ? Math.round(clamp(s.choke, 1, 8, 1)) : null,
    lowpass: clamp(s.lowpass, 20, 20000, d.lowpass),
    highpass: clamp(s.highpass, 20, 20000, d.highpass),
    drive: clamp(s.drive, 0, 10, d.drive),
    delaySend: clamp(s.delaySend, 0, 1, d.delaySend),
    reverbSend: clamp(s.reverbSend, 0, 1, d.reverbSend),
  };
}

function readSample(id: string, v: unknown): SampleRef | null {
  const s = obj(v);
  const source = s.source === 'factory' || s.source === 'user' ? s.source : null;
  const file = str(s.file, '');
  // File names are joined to fixed folders by the main process; refuse anything path-like here too.
  if (!source || !file || /[\\/]|\.\./.test(file)) return null;
  return { id, name: str(s.name, file), source, file, originalName: typeof s.originalName === 'string' ? s.originalName : undefined };
}

/**
 * Parse and validate a project file. Unknown fields are dropped, out-of-range
 * values are clamped, and missing values get defaults. Files from a newer
 * format version are refused rather than silently losing data.
 */
export function parseProject(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFormatError('This file is not valid JSON.');
  }
  const p = obj(raw);
  if (p.format !== PROJECT_FORMAT) throw new ProjectFormatError('This is not a Ba-da-boom project file.');
  const version = typeof p.version === 'number' ? p.version : 0;
  if (version > PROJECT_FORMAT_VERSION) {
    throw new ProjectFormatError(
      `This project was saved by a newer version of Ba-da-boom (format ${version}). Please update the app to open it.`,
    );
  }
  // Migrations from older formats go here, keyed on `version`.
  // 1 -> 2: steps gained `locked`, which readStep defaults to false.

  const tracks: Track[] = (Array.isArray(p.tracks) ? p.tracks : []).map((t, i) => {
    const o = obj(t);
    return {
      id: str(o.id, `t${i + 1}`),
      name: str(o.name, `Track ${i + 1}`),
      mute: bool(o.mute, false),
      solo: bool(o.solo, false),
      sound: readSound(o.sound),
    };
  });
  if (tracks.length === 0) throw new ProjectFormatError('The project has no tracks.');

  const patterns: Pattern[] = (Array.isArray(p.patterns) ? p.patterns : []).map((pt, i) => {
    const o = obj(pt);
    const lanesIn = obj(o.lanes);
    const lanes: Record<string, Lane> = {};
    for (const t of tracks) lanes[t.id] = lanesIn[t.id] ? readLane(lanesIn[t.id]) : emptyLane();
    return { id: str(o.id, `p${i + 1}`), name: str(o.name, String.fromCharCode(65 + i)), lanes };
  });
  if (patterns.length === 0) throw new ProjectFormatError('The project has no patterns.');

  // Factory refs are always available; project refs are kept even if the file is missing,
  // so a missing sample is reported and can be relinked instead of being dropped.
  const samples: Record<string, SampleRef> = factorySampleRefs();
  for (const [id, v] of Object.entries(obj(p.samples))) {
    const ref = readSample(id, v);
    if (ref) samples[id] = ref;
  }

  const currentPatternId = str(p.currentPatternId, patterns[0].id);
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_FORMAT_VERSION,
    name: str(p.name, 'Untitled'),
    bpm: clamp(p.bpm, 20, 300, 120),
    swing: clamp(p.swing, 50, 75, 50),
    seed: Math.round(clamp(p.seed, 0, 2 ** 31 - 1, 1)),
    masterVolume: clamp(p.masterVolume, 0, 1.5, 0.8),
    delayTime: clamp(p.delayTime, 0.01, 2, 0.375),
    delayFeedback: clamp(p.delayFeedback, 0, 0.95, 0.35),
    metronome: bool(p.metronome, false),
    tracks,
    patterns,
    currentPatternId: patterns.some((x) => x.id === currentPatternId) ? currentPatternId : patterns[0].id,
    samples,
  };
}

const isDefaultStep = (s: Step) => !s.on && s.velocity === 0.8 && s.probability === 1 && s.micro === 0 && s.ratchet === 1 && !s.locked;

/** Lanes are stored up to their last non-default step; parseProject fills the rest with defaults. */
export function serializeProject(project: Project): string {
  const patterns = project.patterns.map((pt) => ({
    ...pt,
    lanes: Object.fromEntries(
      Object.entries(pt.lanes).map(([id, lane]) => {
        let last = lane.steps.length - 1;
        while (last >= 0 && isDefaultStep(lane.steps[last])) last--;
        return [id, { length: lane.length, steps: lane.steps.slice(0, last + 1) }];
      }),
    ),
  }));
  return JSON.stringify({ ...project, patterns });
}

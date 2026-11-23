// The play model: what the VST3/CLAP plugin's C++ engine needs to play a project,
// with every choice the app makes already taken (which tracks are heard, and each
// track's superdough controls). The C++ side then only has to do what Strudel and
// superdough do with them, so the plugin and the app cannot drift apart on
// project defaults or mute/solo rules.
//
// Format (version 1), all numbers plain JSON:
//   { version, bpm, swing, seed, masterVolume, songLoop, song: [{ pattern, bars }],
//     tracks: [{ id, name, play, controls }], patterns: [{ id, name, lanes: [lane per track] }],
//     samples: { <superdough sound name>: { file, source } }, currentPattern,
//     noteMap: [track index or -1, for each MIDI note 0..127] }
//   track.note: the MIDI note the track's pad sends (-1 none), as shown on the pads.
//   lane: { length, steps: [[on, velocity, probability, micro, ratchet], ...length] }

import { hasSound, isAudible, soundKey, stepSeed, trackControls } from '../engine/strudel/fromModel';
import type { MidiMap } from '../main/ipc';
import { noteToPad, padNoteList } from '../model/live';
import type { Project } from '../model/types';

export const PLAY_MODEL_VERSION = 1;

export interface PlayModelLane {
  length: number;
  /** [on 0/1, velocity, probability, micro, ratchet] for each of the lane's steps. */
  steps: [number, number, number, number, number][];
}

export interface PlayModel {
  version: number;
  bpm: number;
  swing: number;
  seed: number;
  masterVolume: number;
  songLoop: boolean;
  song: { pattern: number; bars: number }[];
  tracks: { id: string; name: string; play: boolean; note: number; controls: Record<string, unknown> }[];
  patterns: { id: string; name: string; lanes: (PlayModelLane | null)[] }[];
  currentPattern: number;
  samples: Record<string, { file: string; source: string }>;
  noteMap: number[];
}

/** `midiMap`: the MIDI notes setting. `missing`: sample ids that could not be loaded; their tracks are left silent, as in the app. */
export function playModel(project: Project, missing: Set<string> = new Set(), midiMap: MidiMap = 'gm'): PlayModel {
  const notes = padNoteList(project.tracks, midiMap);
  const patternIndex = new Map(project.patterns.map((p, i) => [p.id, i]));
  const samples: PlayModel['samples'] = {};
  for (const ref of Object.values(project.samples)) samples[soundKey(ref.id)] = { file: ref.file, source: ref.source };
  return {
    version: PLAY_MODEL_VERSION,
    bpm: project.bpm,
    swing: project.swing,
    seed: project.seed,
    masterVolume: project.masterVolume,
    songLoop: project.songLoop,
    song: project.song.filter((e) => patternIndex.has(e.patternId)).map((e) => ({ pattern: patternIndex.get(e.patternId)!, bars: e.bars })),
    tracks: project.tracks.map((t, i) => ({
      id: t.id,
      name: t.name,
      play:
        isAudible(t, project.tracks) &&
        hasSound(t) &&
        !(t.sound.source === 'sample' && t.sound.sampleId && missing.has(t.sound.sampleId)),
      note: notes[i] ?? -1,
      controls: trackControls(t, i, project),
    })),
    patterns: project.patterns.map((p) => ({
      id: p.id,
      name: p.name,
      lanes: project.tracks.map((t) => {
        const lane = p.lanes[t.id];
        if (!lane) return null;
        return {
          length: lane.length,
          steps: lane.steps.slice(0, lane.length).map((s) => [s.on ? 1 : 0, s.velocity, s.probability, s.micro, s.ratchet] as [number, number, number, number, number]),
        };
      }),
    })),
    currentPattern: patternIndex.get(project.currentPatternId) ?? 0,
    samples,
    noteMap: Array.from({ length: 128 }, (_, n) => noteToPad(n, project.tracks, midiMap) ?? -1),
  };
}

/** The per-step probability seed, exported so the C++ tests can check they agree. */
export { stepSeed };

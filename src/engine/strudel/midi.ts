// Standard MIDI File export (format 1, one track per drum track, channel 10).
//
// Notes come from the same Strudel pattern as playback and WAV export, so
// probability (resolved with the project seed), ratchets, microtiming and swing
// are exactly what the export would play.

import type { Project } from '../../model/types';
import { patternFromModel } from './fromModel';
import { songPattern } from './song';

export const PPQ = 480;
/** One cycle is one 4/4 bar. */
const TICKS_PER_CYCLE = PPQ * 4;

/** General MIDI drum notes for the factory kit. */
const GM_NOTES: Record<string, number> = {
  kick: 36,
  'kick-sub': 35,
  snare: 38,
  clap: 39,
  rim: 37,
  'hat-closed': 42,
  'hat-open': 46,
  'tom-low': 41,
  'tom-mid': 45,
  'tom-high': 48,
  cowbell: 56,
  clave: 75,
  shaker: 70,
  crash: 49,
  ride: 51,
  conga: 63,
};
/** For imported samples: the note of the factory sound that track starts with. */
const BY_TRACK = [36, 35, 38, 39, 37, 42, 46, 41, 45, 48, 56, 75, 70, 49, 51, 63];

export function midiNote(project: Project, trackIndex: number): number {
  const id = project.tracks[trackIndex]?.sound.sampleId ?? '';
  const factory = id.startsWith('factory:') ? GM_NOTES[id.slice(8)] : undefined;
  return factory ?? BY_TRACK[trackIndex % BY_TRACK.length];
}

export interface MidiNoteEvent {
  track: number;
  tick: number;
  length: number;
  note: number;
  velocity: number;
}

/** The notes of a pattern (or 'song', played once) over `bars` bars. */
export function midiNotes(project: Project, patternId: string | 'song', bars: number): MidiNoteEvent[] {
  const build = (id: string) => {
    const pattern = project.patterns.find((p) => p.id === id);
    if (!pattern) throw new Error('Pattern not found');
    // Every step is written, also for tracks whose sample file is missing.
    return patternFromModel(project, pattern, { missingSamples: new Set(), metronome: false });
  };
  const pat = patternId === 'song' ? songPattern(project.song, false, build) : build(patternId);
  return pat
    .queryArc(0, bars)
    .filter((h) => h.hasOnset() && typeof h.value.orbit === 'number')
    .map((h) => {
      const track = (h.value.orbit as number) - 1;
      const begin = h.whole!.begin.valueOf();
      const dur = h.whole!.end.valueOf() - begin;
      return {
        track,
        tick: Math.max(0, Math.round(begin * TICKS_PER_CYCLE)),
        length: Math.max(10, Math.round(dur * TICKS_PER_CYCLE * 0.9)),
        note: midiNote(project, track),
        velocity: Math.max(1, Math.min(127, Math.round(((h.value.velocity as number) ?? 1) * 127))),
      };
    })
    .sort((a, b) => a.tick - b.tick || a.track - b.track);
}

const varLen = (n: number) => {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
};
const text = (s: string) => [...new TextEncoder().encode(s)];
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function chunk(type: string, data: number[]) {
  return [...text(type), ...u32(data.length), ...data];
}

function trackChunk(events: { tick: number; bytes: number[] }[]) {
  const data: number[] = [];
  let last = 0;
  for (const e of events.sort((a, b) => a.tick - b.tick)) {
    data.push(...varLen(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  data.push(0, 0xff, 0x2f, 0); // end of track
  return chunk('MTrk', data);
}

/** Encode notes as a format 1 SMF: a tempo track plus one named track per drum track that has notes. */
export function encodeMidi(project: Project, notes: MidiNoteEvent[], endTick: number): Uint8Array {
  const usPerQuarter = Math.round(60_000_000 / project.bpm);
  const name = (s: string) => {
    const t = text(s);
    return [0xff, 0x03, ...varLen(t.length), ...t];
  };
  const tracks = [
    trackChunk([
      { tick: 0, bytes: name(project.name) },
      { tick: 0, bytes: [0xff, 0x51, 3, (usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255] },
      { tick: 0, bytes: [0xff, 0x58, 4, 4, 2, 24, 8] },
      { tick: endTick, bytes: [0xff, 0x01, 0] },
    ]),
  ];
  const used = [...new Set(notes.map((n) => n.track))].sort((a, b) => a - b);
  for (const t of used) {
    const events: { tick: number; bytes: number[] }[] = [{ tick: 0, bytes: name(project.tracks[t]?.name ?? `Track ${t + 1}`) }];
    for (const n of notes.filter((x) => x.track === t)) {
      // Note-offs sort before note-ons at the same tick (stable sort, offs pushed first below).
      events.push({ tick: n.tick + n.length, bytes: [0x89, n.note, 0] });
      events.push({ tick: n.tick, bytes: [0x99, n.note, n.velocity] });
    }
    events.sort((a, b) => a.tick - b.tick || (a.bytes[0] === 0x89 ? -1 : 0) - (b.bytes[0] === 0x89 ? -1 : 0));
    tracks.push(trackChunk(events));
  }
  const header = chunk('MThd', [0, 1, (tracks.length >> 8) & 255, tracks.length & 255, (PPQ >> 8) & 255, PPQ & 255]);
  return new Uint8Array([...header, ...tracks.flat()]);
}

export function exportMidi(project: Project, patternId: string | 'song', bars: number): { bytes: Uint8Array; notes: number } {
  const notes = midiNotes(project, patternId, bars);
  return { bytes: encodeMidi(project, notes, bars * TICKS_PER_CYCLE), notes: notes.length };
}

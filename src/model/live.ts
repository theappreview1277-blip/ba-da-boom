// Playing live: which track a MIDI note or a key plays, and where a hit lands
// in the pattern when recording.
import type { MidiMap } from '../main/ipc';
import { STEPS_PER_BAR } from './types';

/**
 * General MIDI drum notes, mapped onto the factory kit's track order
 * (kick, sub kick, snare, clap, rim, closed hat, open hat, low/mid/high tom,
 * cowbell, clave, shaker, crash, ride, conga).
 */
export const GM_DRUMS: Record<number, number> = {
  36: 0, // bass drum 1
  35: 1, // acoustic bass drum
  38: 2, // acoustic snare
  40: 2, // electric snare
  39: 3, // hand clap
  37: 4, // side stick
  42: 5, // closed hi-hat
  44: 5, // pedal hi-hat
  46: 6, // open hi-hat
  41: 7, // low floor tom
  43: 7, // high floor tom
  45: 7, // low tom
  47: 8, // low-mid tom
  48: 8, // hi-mid tom
  50: 9, // high tom
  56: 10, // cowbell
  75: 11, // claves
  70: 12, // maracas
  69: 12, // cabasa
  82: 12, // shaker
  49: 13, // crash 1
  57: 13, // crash 2
  51: 14, // ride 1
  59: 14, // ride 2
  53: 14, // ride bell
  62: 15, // mute high conga
  63: 15, // open high conga
  64: 15, // low conga
};

/** The track (by position) a MIDI note plays, or null. */
export function noteToTrack(note: number, map: MidiMap, trackCount: number): number | null {
  const i = map === 'pads36' ? note - 36 : GM_DRUMS[note];
  return i !== undefined && i >= 0 && i < trackCount ? i : null;
}

/** The MIDI note that plays a track, for showing on the pads. */
export function trackNote(index: number, map: MidiMap): number | null {
  if (map === 'pads36') return 36 + index;
  const notes = Object.keys(GM_DRUMS).map(Number).filter((n) => GM_DRUMS[n] === index);
  return notes.length ? Math.min(...notes) : null;
}

/** A note name such as C1 (note 36), as most drum controllers label them. */
export const noteName = (n: number) => `${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][n % 12]}${Math.floor(n / 12) - 2}`;

/** A note-on in a MIDI message, or null for anything else. Velocity 0..1. */
export function parseNoteOn(data: ArrayLike<number>): { note: number; velocity: number } | null {
  if (data.length < 3 || (data[0] & 0xf0) !== 0x90 || data[2] === 0) return null;
  return { note: data[1] & 0x7f, velocity: (data[2] & 0x7f) / 127 };
}

/** Keys that play pads 1–16 when "Keys play pads" is on: the bottom letter row, then the middle row. */
export const PAD_KEYS = ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k'];

/**
 * Where a hit heard at `cycle` bars into the pattern lands in a lane of `length`
 * steps: the nearest step, and how early or late it was (-0.5..0.5 of a step).
 */
export function hitStep(cycle: number, length: number, quantise: boolean): { step: number; micro: number } {
  const pos = cycle * STEPS_PER_BAR;
  const nearest = Math.round(pos);
  const micro = quantise ? 0 : Math.max(-0.5, Math.min(0.5, Math.round((pos - nearest) * 100) / 100));
  return { step: ((nearest % length) + length) % length, micro };
}

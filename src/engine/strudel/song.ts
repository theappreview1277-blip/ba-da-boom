// The song arrangement as one Strudel pattern.
//
// Each entry plays its pattern for `bars` cycles, starting the pattern from its
// own cycle 0 (like a pattern switch), one after the other. With `loop` the
// arrangement repeats; without it, it is silent after the last entry.

import type { SongEntry } from '../../model/types';
import { Fraction, PatternClass, TimeSpan, type StrudelHap, type StrudelPattern } from './strudel';

export interface SongPosition {
  index: number;
  entry: SongEntry;
  /** First cycle of this entry, counted from the start of the song (including earlier loops). */
  start: number;
  /** Which pass through the song this is (0 = first). */
  pass: number;
}

export const songLength = (song: SongEntry[]) => song.reduce((n, e) => n + e.bars, 0);

/** The entry playing at `cycle` cycles after the song started, or null after the end (no loop) or for an empty song. */
export function songPosition(song: SongEntry[], loop: boolean, cycle: number): SongPosition | null {
  const total = songLength(song);
  if (!total || cycle < 0) return null;
  const pass = Math.floor(cycle / total);
  if (pass > 0 && !loop) return null;
  let start = pass * total;
  for (let index = 0; index < song.length; index++) {
    const entry = song[index];
    if (cycle < start + entry.bars) return { index, entry, start, pass };
    start += entry.bars;
  }
  return null;
}

/** `build` turns a pattern id into its Strudel pattern (the same one used for single-pattern playback). */
export function songPattern(song: SongEntry[], loop: boolean, build: (patternId: string) => StrudelPattern): StrudelPattern {
  const built = new Map<string, StrudelPattern>();
  const patternFor = (id: string) => {
    let p = built.get(id);
    if (!p) built.set(id, (p = build(id)));
    return p;
  };
  return new PatternClass((state: any) => {
    const begin = state.span.begin.valueOf();
    const end = state.span.end.valueOf();
    const out: StrudelHap[] = [];
    let at = begin;
    while (at < end) {
      const pos = songPosition(song, loop, at);
      if (!pos) break;
      const pieceEnd = Math.min(end, pos.start + pos.entry.bars);
      const span = at === begin && pieceEnd === end ? state.span : new TimeSpan(Fraction(at), Fraction(pieceEnd));
      out.push(...patternFor(pos.entry.patternId).late(pos.start).query(state.setSpan(span)));
      at = pieceEnd;
    }
    return out;
  });
}

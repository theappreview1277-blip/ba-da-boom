// Tap tempo: the tempo from the times of the last few taps.

/** Taps further apart than this start a new count. */
export const TAP_RESET_MS = 2000;
/** The tempo is the average over at most this many gaps between taps. */
const TAP_GAPS = 4;

/**
 * Add a tap at `now` (milliseconds) to the earlier taps. Returns the taps to
 * keep and the tempo they give (one decimal, 20..300 BPM), or null after the
 * first tap of a new count.
 */
export function tapTempo(taps: readonly number[], now: number): { taps: number[]; bpm: number | null } {
  const last = taps[taps.length - 1];
  const kept = last !== undefined && now - last > 0 && now - last <= TAP_RESET_MS ? [...taps, now].slice(-(TAP_GAPS + 1)) : [now];
  if (kept.length < 2) return { taps: kept, bpm: null };
  const gap = (kept[kept.length - 1] - kept[0]) / (kept.length - 1);
  const bpm = Math.round((60000 / gap) * 10) / 10;
  return { taps: kept, bpm: Math.min(300, Math.max(20, bpm)) };
}

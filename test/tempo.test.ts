import { describe, expect, it } from 'vitest';
import { TAP_RESET_MS, tapTempo } from '../src/model/tempo';

const tapAt = (times: number[]) => times.reduce<{ taps: number[]; bpm: number | null }>((s, t) => tapTempo(s.taps, t), { taps: [], bpm: null });

describe('tap tempo', () => {
  it('needs two taps, then gives the tempo of the gaps', () => {
    expect(tapTempo([], 1000)).toEqual({ taps: [1000], bpm: null });
    expect(tapAt([0, 500]).bpm).toBe(120);
    expect(tapAt([0, 500, 1000, 1500]).bpm).toBe(120);
    expect(tapAt([0, 345, 690, 1035]).bpm).toBe(173.9);
  });

  it('averages the last four gaps, so one late tap does not throw it off', () => {
    expect(tapAt([0, 500, 1000, 1550, 2050]).bpm).toBe(117.1);
    // Only the last five taps count.
    expect(tapAt([0, 1000, 1500, 2000, 2500, 3000]).taps).toEqual([1000, 1500, 2000, 2500, 3000]);
    expect(tapAt([0, 1000, 1500, 2000, 2500, 3000]).bpm).toBe(120);
  });

  it('a long pause starts a new count', () => {
    const s = tapAt([0, 500, 1000, 1000 + TAP_RESET_MS + 1]);
    expect(s).toEqual({ taps: [1000 + TAP_RESET_MS + 1], bpm: null });
  });

  it('stays in the app\'s tempo range', () => {
    expect(tapAt([0, 150]).bpm).toBe(300);
    expect(tapAt([0, 100]).bpm).toBe(300);
    expect(tapAt([0, 1999]).bpm).toBe(30);
  });
});

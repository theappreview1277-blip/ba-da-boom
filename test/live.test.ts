import { describe, expect, it } from 'vitest';
import { GM_DRUMS, hitStep, noteName, noteToTrack, parseNoteOn, trackNote } from '../src/model/live';

describe('playing live', () => {
  it('maps General MIDI drum notes onto the factory kit order', () => {
    expect(noteToTrack(36, 'gm', 16)).toBe(0);
    expect(noteToTrack(38, 'gm', 16)).toBe(2);
    expect(noteToTrack(42, 'gm', 16)).toBe(5);
    expect(noteToTrack(46, 'gm', 16)).toBe(6);
    expect(noteToTrack(49, 'gm', 16)).toBe(13);
    expect(noteToTrack(60, 'gm', 16)).toBeNull();
    expect(noteToTrack(49, 'gm', 8)).toBeNull();
    expect(Object.values(GM_DRUMS).every((i) => i >= 0 && i < 16)).toBe(true);
  });
  it('maps pad controllers from note 36 in order', () => {
    expect(noteToTrack(36, 'pads36', 16)).toBe(0);
    expect(noteToTrack(51, 'pads36', 16)).toBe(15);
    expect(noteToTrack(52, 'pads36', 16)).toBeNull();
    expect(noteToTrack(35, 'pads36', 16)).toBeNull();
  });
  it('shows each pad its note', () => {
    expect(trackNote(0, 'gm')).toBe(36);
    expect(trackNote(2, 'gm')).toBe(38);
    expect(trackNote(7, 'gm')).toBe(41);
    expect(trackNote(5, 'pads36')).toBe(41);
    expect(noteName(36)).toBe('C1');
    expect(noteName(42)).toBe('F#1');
  });
  it('reads note-ons and ignores note-offs and other messages', () => {
    expect(parseNoteOn([0x99, 38, 127])).toEqual({ note: 38, velocity: 1 });
    expect(parseNoteOn([0x90, 36, 64])?.velocity).toBeCloseTo(64 / 127);
    expect(parseNoteOn([0x90, 36, 0])).toBeNull();
    expect(parseNoteOn([0x80, 36, 64])).toBeNull();
    expect(parseNoteOn([0xf8])).toBeNull();
    expect(parseNoteOn([0xb0, 1, 64])).toBeNull();
  });
  it('puts a recorded hit on the nearest step', () => {
    expect(hitStep(0, 16, true)).toEqual({ step: 0, micro: 0 });
    expect(hitStep(4.1 / 16, 16, true)).toEqual({ step: 4, micro: 0 });
    expect(hitStep(3.6 / 16, 16, true)).toEqual({ step: 4, micro: 0 });
    // A hit just before the loop comes round lands on step 1 of the next time round.
    expect(hitStep(15.8 / 16, 16, true)).toEqual({ step: 0, micro: 0 });
    // Bars after the first wrap round a one-bar lane, and fill a longer one.
    expect(hitStep(1 + 2 / 16, 16, true).step).toBe(2);
    expect(hitStep(1 + 2 / 16, 64, true).step).toBe(18);
  });
  it('keeps how early or late a hit was when not quantising', () => {
    expect(hitStep(4.2 / 16, 16, false)).toEqual({ step: 4, micro: 0.2 });
    expect(hitStep(3.7 / 16, 16, false)).toEqual({ step: 4, micro: -0.3 });
  });
});

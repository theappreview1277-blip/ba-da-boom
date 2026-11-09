import { describe, expect, it } from 'vitest';
import { assignKey, assignNote, GM_DRUMS, hitStep, keyToPad, noteName, noteToPad, noteToTrack, padKeyList, padNoteList, parseNoteOn, resetPadAssignments, trackNote } from '../src/model/live';
import { newProject } from '../src/model/defaults';
import { parseProject, serializeProject } from '../src/model/serialize';

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

describe('keys and notes chosen by hand', () => {
  const project = () => newProject();
  it('without choices, pads use the usual keys and notes', () => {
    const p = project();
    expect(padKeyList(p.tracks).slice(0, 3)).toEqual(['z', 'x', 'c']);
    expect(keyToPad('x', p.tracks)).toBe(1);
    expect(noteToPad(38, p.tracks, 'gm')).toBe(2);
    expect(padNoteList(p.tracks, 'gm')[2]).toBe(38);
  });
  it('a chosen key plays its track, and the pad that had it by default gives it up', () => {
    let p = assignKey(project(), "t5", 'z');
    expect(keyToPad('z', p.tracks)).toBe(4);
    expect(padKeyList(p.tracks)[0]).toBeNull();
    p = assignKey(p, p.tracks[4].id, 'q');
    expect(keyToPad('z', p.tracks)).toBe(0); // kick gets its key back
    expect(keyToPad('q', p.tracks)).toBe(4);
  });
  it('no two tracks keep the same chosen key or note', () => {
    let p = project();
    p = assignKey(p, p.tracks[1].id, 'q');
    p = assignKey(p, p.tracks[2].id, 'q');
    expect(p.tracks[1].key).toBe('');
    expect(keyToPad('q', p.tracks)).toBe(2);
    p = assignNote(p, p.tracks[1].id, 60);
    p = assignNote(p, p.tracks[3].id, 60);
    expect(p.tracks[1].note).toBe(-1);
    expect(noteToPad(60, p.tracks, 'gm')).toBe(3);
  });
  it('a chosen note wins over the notes setting; a track with its own note ignores the setting', () => {
    let p = assignNote(project(), "t1", 38); // kick on the snare note
    expect(noteToPad(38, p.tracks, 'gm')).toBe(0);
    expect(noteToPad(36, p.tracks, 'gm')).toBeNull(); // the kick no longer answers to 36
    expect(padNoteList(p.tracks, 'gm')[2]).toBeNull(); // snare shows no note now
    expect(noteToPad(40, p.tracks, 'gm')).toBe(2); // but its other GM note still plays it
    p = assignNote(p, p.tracks[5].id, -1);
    expect(noteToPad(42, p.tracks, 'gm')).toBeNull();
  });
  it('a key cleared by hand stays off; reset brings back the usual layout', () => {
    let p = assignKey(project(), "t1", '');
    expect(keyToPad('z', p.tracks)).toBe(-1);
    p = resetPadAssignments(assignNote(p, p.tracks[0].id, 50));
    expect(keyToPad('z', p.tracks)).toBe(0);
    expect(noteToPad(36, p.tracks, 'gm')).toBe(0);
    expect(p.tracks.every((t) => t.key === undefined && t.note === undefined)).toBe(true);
  });
  it('choices are saved with the project, and bad values are dropped', () => {
    let p = assignKey(project(), "t1", 'q');
    p = assignNote(p, p.tracks[1].id, 61);
    const back = parseProject(serializeProject(p));
    expect([back.tracks[0].key, back.tracks[1].note, back.tracks[2].key]).toEqual(['q', 61, undefined]);
    const raw = JSON.parse(serializeProject(p));
    raw.tracks[0].key = 'Enter';
    raw.tracks[1].note = 300;
    const bad = parseProject(JSON.stringify(raw));
    expect([bad.tracks[0].key, bad.tracks[1].note]).toEqual([undefined, undefined]);
  });
});

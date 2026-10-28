import { describe, expect, it } from 'vitest';
import { newProject } from '../src/model/defaults';
import { commit, duplicatePattern, historyOf, pasteLane, redo, toggleStep, undo } from '../src/model/ops';

describe('history and pattern ops', () => {
  it('undo/redo and merged slider gestures', () => {
    const p0 = newProject();
    let h = historyOf(p0);
    const id = p0.patterns[0].id;
    h = commit(h, toggleStep(h.present, id, 't2', 0));
    h = commit(h, { ...h.present, bpm: 121 }, 'bpm:1');
    h = commit(h, { ...h.present, bpm: 122 }, 'bpm:1');
    h = commit(h, { ...h.present, bpm: 123 }, 'bpm:1');
    expect(h.past.length).toBe(2);
    h = undo(h);
    expect(h.present.bpm).toBe(120);
    expect(h.present.patterns[0].lanes.t2.steps[0].on).toBe(true);
    h = undo(h);
    expect(h.present).toBe(p0);
    h = redo(redo(h));
    expect(h.present.bpm).toBe(123);
  });
  it('duplicate and paste copy data without sharing it', () => {
    const p = newProject();
    const d = duplicatePattern(p, p.patterns[0].id);
    expect(d.patterns.length).toBe(p.patterns.length + 1);
    expect(d.currentPatternId).toBe(d.patterns[1].id);
    expect(d.patterns[1].lanes.t1).toEqual(p.patterns[0].lanes.t1);
    const q = pasteLane(d, d.patterns[2].id, 't4', d.patterns[0].lanes.t1);
    expect(q.patterns[2].lanes.t4).not.toBe(q.patterns[0].lanes.t1);
    expect(q.patterns[2].lanes.t4.steps[0].on).toBe(true);
  });
});

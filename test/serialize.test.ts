import { describe, expect, it } from 'vitest';
import { newProject } from '../src/model/defaults';
import { setStep } from '../src/model/ops';
import { parseProject, serializeProject, ProjectFormatError } from '../src/model/serialize';
import { PROJECT_FORMAT_VERSION } from '../src/model/types';

describe('project files', () => {
  it('round-trips a project exactly', () => {
    let p = newProject();
    p = setStep(p, p.patterns[1].id, 't9', 63, { on: true, velocity: 0.3, probability: 0.4, micro: -0.2, ratchet: 3 });
    p = { ...p, samples: { ...p.samples, 'user:abc.wav': { id: 'user:abc.wav', name: 'abc', source: 'user', file: 'abc.wav', originalName: 'abc.wav' } } };
    const back = parseProject(serializeProject(p));
    expect(back).toEqual(p);
    expect(serializeProject(p).length).toBeLessThan(20000);
  });
  it('refuses newer formats and non-projects', () => {
    const text = serializeProject(newProject()).replace(/"version":\d+/, '"version":99');
    expect(() => parseProject(text)).toThrow(/newer version/);
    expect(() => parseProject('{"hello":1}')).toThrow(ProjectFormatError);
    expect(() => parseProject('not json')).toThrow(/not valid JSON/);
  });
  it('clamps bad values and rejects path-like sample file names', () => {
    const p = JSON.parse(serializeProject(newProject()));
    p.bpm = 9999;
    p.patterns[0].lanes.t1.steps[0].velocity = 5;
    p.samples.evil = { source: 'user', file: '..\\\\..\\\\windows\\\\x.wav', name: 'x' };
    const back = parseProject(JSON.stringify(p));
    expect(back.bpm).toBe(300);
    expect(back.patterns[0].lanes.t1.steps[0].velocity).toBe(1);
    expect(back.samples.evil).toBeUndefined();
  });
  it('keeps references to missing user samples', () => {
    const p = newProject();
    p.samples['user:gone.wav'] = { id: 'user:gone.wav', name: 'gone', source: 'user', file: 'gone.wav' };
    p.tracks[0].sound.sampleId = 'user:gone.wav';
    const back = parseProject(serializeProject(p));
    expect(back.tracks[0].sound.sampleId).toBe('user:gone.wav');
    expect(back.samples['user:gone.wav']).toBeDefined();
  });
});

describe('format 1 files', () => {
  it('open with every step unlocked, and locks survive a round trip', () => {
    const fresh = newProject();
    const p = setStep(fresh, fresh.patterns[0].id, 't2', 5, { on: true, locked: true });
    const v1 = JSON.parse(serializeProject(newProject()));
    v1.version = 1;
    for (const pt of v1.patterns) for (const l of Object.values(pt.lanes) as any[]) for (const s of l.steps) delete s.locked;
    const opened = parseProject(JSON.stringify(v1));
    expect(opened.version).toBe(PROJECT_FORMAT_VERSION);
    expect(opened.patterns.every((pt) => Object.values(pt.lanes).every((l) => l.steps.every((s) => s.locked === false)))).toBe(true);
    const back = parseProject(serializeProject(p));
    expect(back.patterns[0].lanes.t2.steps[5]).toMatchObject({ on: true, locked: true });
  });
});

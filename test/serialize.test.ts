import { describe, expect, it } from 'vitest';
import { newProject } from '../src/model/defaults';
import { setStep } from '../src/model/ops';
import { parseProject, serializeProject, ProjectFormatError } from '../src/model/serialize';

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
    const text = serializeProject(newProject()).replace('"version":1', '"version":99');
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

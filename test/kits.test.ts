import { describe, expect, it } from 'vitest';
import catalogue from '../src/main/strudel-kits.json';
import { kitAssignments, kitLabel, kitSampleName, validKitPath } from '../src/model/kits';

const kits = catalogue.kits as Record<string, Record<string, string[]>>;

describe('Strudel drum machine kits', () => {
  it('lists all 71 kits with valid file paths', () => {
    expect(Object.keys(kits)).toHaveLength(71);
    expect(kits.RolandTR909.bd).toHaveLength(4);
    const paths = Object.values(kits).flatMap((k) => Object.values(k).flat());
    expect(paths.length).toBeGreaterThan(2000);
    expect(paths.every(validKitPath)).toBe(true);
    expect(catalogue.base).toBe('https://raw.githubusercontent.com/ritchse/tidal-drum-machines/main/machines/');
  });

  it('refuses paths that leave the kit folder', () => {
    for (const p of ['../x.wav', 'a/../../x.wav', '/etc/x.wav', 'a\\b.wav', 'a//b.wav', 'a/b.mp3']) expect(validKitPath(p)).toBe(false);
    expect(validKitPath('YamahaRM50/yamaharm50-bd/BD-011..wav')).toBe(true);
  });

  it('puts kit sounds on the matching tracks and keeps tracks it has no sound for', () => {
    const plan = kitAssignments(kits.RolandTR909, 16);
    expect(plan[0]).toEqual(['bd', 0]);
    expect(plan[1]).toEqual(['bd', 1]);
    expect(plan.slice(2, 10)).toEqual([['sd', 0], ['cp', 0], ['rim', 0], ['hh', 0], ['oh', 0], ['lt', 0], ['mt', 0], ['ht', 0]]);
    expect(plan[10]).toBeNull(); // no cowbell on the 909
    expect([plan[13], plan[14]]).toEqual([['cr', 0], ['rd', 0]]);
    expect(plan.filter(Boolean)).toHaveLength(12);
  });

  it('falls back to other sounds', () => {
    const plan = kitAssignments({ bd: ['a'], tb: ['b'], misc: ['c'] }, 16);
    expect(plan[1]).toEqual(['bd', 0]); // only one kick: the sub kick uses it too
    expect(plan[12]).toEqual(['tb', 0]); // tambourine for the shaker
    expect(plan[15]).toEqual(['tb', 0]);
  });

  it('names kits and sounds readably', () => {
    expect(kitLabel('RolandTR909')).toBe('Roland TR909');
    expect(kitLabel('AkaiMPC60')).toBe('Akai MPC60');
    expect(kitSampleName('RolandTR909', 'hh', 1, 4)).toBe('Roland TR909 Closed Hat 2');
    expect(kitSampleName('CasioVL1', 'bd', 0, 1)).toBe('Casio VL1 Kick');
  });
});

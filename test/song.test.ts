import { describe, expect, it } from 'vitest';
import { patternFromModel, soundKey } from '../src/engine/strudel/fromModel';
import { songPattern, songPosition } from '../src/engine/strudel/song';
import { newProject } from '../src/model/defaults';
import { setLaneLength, setStep, songAdd, songMove, songRemove, songSetBars, patternBars } from '../src/model/ops';
import { parseProject, serializeProject } from '../src/model/serialize';
import type { Project } from '../src/model/types';

function twoPatterns(): Project {
  let p = newProject();
  for (const pt of p.patterns) for (const lane of Object.values(pt.lanes)) lane.steps.forEach((s) => (s.on = false));
  const [a, b] = p.patterns;
  p = setStep(p, a.id, 't1', 0, { on: true }); // kick on every bar of A
  p = setStep(p, b.id, 't3', 4, { on: true }); // snare on beat 2 of B
  // B has a 3-step lane, to check it restarts from its own step 0 on entry.
  p = setStep(p, b.id, 't6', 0, { on: true });
  p = setLaneLength(p, b.id, 't6', 3);
  return p;
}

const hits = (p: Project, loop: boolean, begin: number, end: number) =>
  songPattern(p.song, loop, (id) => patternFromModel(p, p.patterns.find((x) => x.id === id)!))
    .queryArc(begin, end)
    .filter((h) => h.hasOnset())
    .map((h) => `${+h.whole!.begin.valueOf().toFixed(4)}:${h.value.s === soundKey('factory:kick') ? 'k' : h.value.s === soundKey('factory:snare') ? 's' : 'h'}`)
    .sort((x, y) => parseFloat(x) - parseFloat(y) || x.localeCompare(y));

describe('song arrangement', () => {
  it('plays entries in order, each pattern from its own start, and loops', () => {
    let p = twoPatterns();
    const [a, b] = p.patterns;
    p = songAdd(p, a.id);
    p = songSetBars(p, 0, 2);
    p = songAdd(p, b.id);
    // A A B | A A B
    const h = hits(p, true, 0, 6);
    expect(h.filter((x) => x.endsWith('k'))).toEqual(['0:k', '1:k', '3:k', '4:k']);
    expect(h.filter((x) => x.endsWith('s'))).toEqual(['2.25:s', '5.25:s']);
    // The 3-step hat lane starts at the entry's first step: 2, 2+3/16, ...
    expect(h.filter((x) => x.endsWith('h')).slice(0, 3)).toEqual(['2:h', '2.1875:h', '2.375:h']);
  });

  it('without loop it is silent after the last entry', () => {
    let p = twoPatterns();
    p = songAdd(p, p.patterns[0].id);
    expect(hits(p, false, 0, 4)).toEqual(['0:k']);
    expect(songPosition(p.song, false, 1.5)).toBeNull();
    expect(songPosition(p.song, true, 1.5)?.pass).toBe(1);
  });

  it('queries split across entry boundaries lose and duplicate nothing', () => {
    let p = twoPatterns();
    p = songAdd(songAdd(songAdd(p, p.patterns[0].id), p.patterns[1].id), p.patterns[0].id);
    const whole = hits(p, true, 0, 9);
    const pieces: string[] = [];
    for (let t = 0; t < 9; t += 0.37) pieces.push(...hits(p, true, t, Math.min(9, t + 0.37)));
    expect(pieces.sort()).toEqual(whole.slice().sort());
  });

  it('editing the song: add, move, remove, bars; saved in the project file', () => {
    let p = twoPatterns();
    const [a, b, c] = p.patterns;
    p = setLaneLength(p, c.id, 't2', 40);
    expect(patternBars(p, c.id)).toBe(3);
    p = songAdd(songAdd(songAdd(p, a.id), b.id), c.id);
    expect(p.song.map((e) => e.bars)).toEqual([1, 1, 3]);
    p = songMove(p, 2, 0);
    expect(p.song.map((e) => e.patternId)).toEqual([c.id, a.id, b.id]);
    p = songRemove(p, 1);
    p = songSetBars(p, 1, 99);
    expect(p.song).toEqual([{ patternId: c.id, bars: 3 }, { patternId: b.id, bars: 64 }]);
    p = { ...p, songLoop: false };
    const back = parseProject(serializeProject(p));
    expect(back.song).toEqual(p.song);
    expect(back.songLoop).toBe(false);
  });

  it('older files open with an empty song, and entries for unknown patterns are refused', () => {
    const v2 = JSON.parse(serializeProject(newProject()));
    v2.version = 2;
    delete v2.song;
    delete v2.songLoop;
    const opened = parseProject(JSON.stringify(v2));
    expect(opened.song).toEqual([]);
    expect(opened.songLoop).toBe(true);
    v2.version = 3;
    v2.song = [{ patternId: 'nope', bars: 2 }, { patternId: v2.patterns[0].id, bars: 2 }];
    expect(parseProject(JSON.stringify(v2)).song).toEqual([{ patternId: v2.patterns[0].id, bars: 2 }]);
  });
});

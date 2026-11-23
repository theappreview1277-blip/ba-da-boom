// Reference events for the plugin's C++ engine. Random projects are played through the
// app's own Strudel patterns; every hit (time, track, loudness, length) is written to
// plugin/tests/vectors.json together with each project's play model. The C++ tests
// read the same file and must produce exactly these hits.
//
// The file is checked here against a fresh run, so it cannot go stale. To write it
// again after a deliberate change: BDB_WRITE_VECTORS=1 npx vitest run test/pluginVectors.test.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newProject, emptyPattern } from '../src/model/defaults';
import { patternFromModel } from '../src/engine/strudel/fromModel';
import { songPattern } from '../src/engine/strudel/song';
import { playModel } from '../src/plugin/playModel';
import type { Project } from '../src/model/types';

const FILE = new URL('../plugin/tests/vectors.json', import.meta.url);

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomProject(n: number): Project {
  const r = mulberry(1000 + n);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const p = structuredClone(newProject());
  p.bpm = Math.round(60 + r() * 120);
  p.swing = r() < 0.5 ? 50 : Math.round((50 + r() * 25) * 2) / 2;
  p.seed = Math.floor(r() * 100000);
  p.patterns.push(emptyPattern(p.tracks, 'B'), emptyPattern(p.tracks, 'C'));
  p.patterns.forEach((pt, pi) => (pt.id = `p${pi}`));
  p.currentPatternId = 'p0';
  for (const pt of p.patterns) {
    for (const t of p.tracks) {
      const lane = pt.lanes[t.id];
      lane.length = pick([3, 5, 7, 8, 12, 16, 16, 16, 24, 32, 64]);
      lane.steps.forEach((s, i) => {
        s.on = i < lane.length && r() < 0.35;
        s.velocity = Math.round(r() * 100) / 100;
        s.probability = r() < 0.6 ? 1 : Math.round(r() * 100) / 100;
        s.micro = r() < 0.7 ? 0 : Math.round((r() - 0.5) * 100) / 100;
        s.ratchet = r() < 0.8 ? 1 : pick([2, 3, 4, 8]);
      });
    }
  }
  p.tracks.forEach((t) => {
    t.mute = r() < 0.1;
    t.solo = n % 4 === 3 && r() < 0.2;
    if (r() < 0.1) t.sound = { ...t.sound, sampleId: null };
  });
  p.song = [
    { patternId: 'p1', bars: 1 + Math.floor(r() * 3) },
    { patternId: 'p0', bars: 1 + Math.floor(r() * 4) },
    { patternId: 'p2', bars: 2 },
  ];
  p.songLoop = n % 2 === 0;
  return p;
}

const round = (x: number) => Math.round(x * 1e9) / 1e9;

function hits(pattern: ReturnType<typeof patternFromModel>, begin: number, end: number) {
  return pattern
    .queryArc(begin, end)
    .filter((h) => h.hasOnset())
    .map((h) => [round(+h.whole!.begin.valueOf()), (h.value.orbit as number) - 1, h.value.velocity as number, round(+h.whole!.end.valueOf() - +h.whole!.begin.valueOf())])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function build() {
  const cases = [];
  for (let n = 0; n < 12; n++) {
    const p = randomProject(n);
    const byId = (id: string) => patternFromModel(p, p.patterns.find((x) => x.id === id)!);
    const songBarsTotal = p.song.reduce((a, e) => a + e.bars, 0);
    cases.push({
      model: playModel(p),
      // Each pattern from its cycle 0 for 9 bars; the song for one pass and 3 bars more.
      patterns: p.patterns.map((pt) => hits(byId(pt.id), 0, 9)),
      song: { end: songBarsTotal + 3, hits: hits(songPattern(p.song, p.songLoop, byId), 0, songBarsTotal + 3) },
    });
  }
  return { note: 'Written by test/pluginVectors.test.ts. hit = [cycle, track, velocity, length in cycles].', cases };
}

describe('plugin reference events', () => {
  it('match the app (plugin/tests/vectors.json is current)', () => {
    const fresh = JSON.stringify(build());
    if (process.env.BDB_WRITE_VECTORS) writeFileSync(FILE, fresh);
    expect(existsSync(FILE)).toBe(true);
    expect(readFileSync(FILE, 'utf8')).toBe(fresh);
  });
  it('cover probability, ratchets, timing, swing, polymeters and songs', () => {
    const data = build();
    const all = data.cases.flatMap((c) => c.patterns.flat());
    expect(all.length).toBeGreaterThan(2000);
    expect(new Set(all.map((h) => h[3])).size).toBeGreaterThanOrEqual(5); // ratchets give shorter hits
    expect(all.some((h) => Math.abs(h[0] * 16 - Math.round(h[0] * 16)) > 1e-6)).toBe(true); // off-grid timing
    expect(data.cases.some((c) => !c.model.songLoop) && data.cases.some((c) => c.model.songLoop)).toBe(true);
  });
});

// The beat a newly added plugin plays before its screen has been opened: the app's new
// project, as a play model. Built into the plugin from plugin/default-model.json.
describe('the plugin starts with the app new project', () => {
  it('plugin/default-model.json is current', () => {
    const file = new URL('../plugin/default-model.json', import.meta.url);
    // Pattern ids are random: fixed ones keep the file stable.
    const project = newProject();
    project.patterns.forEach((x, i) => {
      if (x.id === project.currentPatternId) project.currentPatternId = `p${i}`;
      x.id = `p${i}`;
    });
    const fresh = JSON.stringify(playModel(project));
    if (process.env.BDB_WRITE_VECTORS) writeFileSync(file, fresh);
    expect(readFileSync(file, 'utf8')).toBe(fresh);
  });
});

import { describe, expect, it } from 'vitest';
import { newProject } from '../src/model/defaults';
import { currentPattern, setStep } from '../src/model/ops';
import {
  CATEGORIES,
  CLASSICS,
  ROLES,
  VARIANT_COUNT,
  addClassicPatterns,
  classicById,
  classicHits,
  classicVariant,
  detectStyle,
  loadClassic,
} from '../src/model/rhythm';
import { parseProject, serializeProject } from '../src/model/serialize';
import type { Project } from '../src/model/types';

// Factory track ids: t1 Kick, t3 Snare, t4 Clap, t5 Rim, t6 Closed Hat, t7 Open Hat, t8-10 toms, t14 Crash, t15 Ride.
const KICK = 't1';
const SNARE = 't3';
const HAT = 't6';
const OPENHAT = 't7';
const RIDE = 't15';
const CRASH = 't14';

const grid = (p: Project, trackId: string, patternId = p.currentPatternId) => {
  const l = p.patterns.find((x) => x.id === patternId)!.lanes[trackId];
  return l.steps.slice(0, l.length).map((s) => (s.on ? 'x' : '.')).join('');
};
/** A part as on/off, the way the grid shows it. */
const onOff = (part: string) => part.replace(/[^.]/g, 'x');

describe('named beat library', () => {
  it('has the classic breaks by name, each with named variants', () => {
    const names = CLASSICS.map((c) => c.name);
    for (const n of ['Amen break', 'Funky Drummer', 'Apache', 'Think (About It)', 'Soul Pride', 'Cold Sweat', 'Impeach the President', 'When the Levee Breaks', 'Boom bap', 'Purdie shuffle', 'Two-step', 'Dembow (reggaeton)']) {
      expect(names).toContain(n);
    }
    expect(CLASSICS.length).toBeGreaterThanOrEqual(40);
    expect(VARIANT_COUNT).toBeGreaterThanOrEqual(120);
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(6);
    expect(classicById('amen').variants.length).toBeGreaterThanOrEqual(5);
  });

  it('has the second batch of beats across more kinds of music', () => {
    const ids = CLASSICS.map((c) => c.id);
    for (const id of ['jazz-swing', 'second-line', 'gospel', 'new-jack', 'rnb-90s', 'crunk', 'bounce', 'phonk', 'jersey-club', 'footwork', 'trip-hop', 'synthwave', 'hardstyle', 'gabber', 'moombahton', 'mambo', 'chacha', 'soca', 'merengue', 'cumbia', 'tango', 'bolero', 'highlife', 'bhangra', 'maqsum', 'pop', 'surf', 'country']) {
      expect(ids).toContain(id);
    }
    expect(CATEGORIES).toContain('Jazz');
    expect(CLASSICS.length).toBeGreaterThanOrEqual(75);
    expect(VARIANT_COUNT).toBeGreaterThanOrEqual(230);
    // No beat is listed twice under another name.
    const names = CLASSICS.map((c) => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    // Baladi: doum doum . tek doum . tek .
    const baladi = classicById('maqsum').variants.find((v) => v.name === 'Baladi')!;
    expect(baladi.parts.tomlow).toBe('X.X.....X.......');
    expect(baladi.parts.rim).toBe('......x.....x...');
  });

  it('every beat and variant is well formed', () => {
    expect(new Set(CLASSICS.map((c) => c.id)).size).toBe(CLASSICS.length);
    expect(new Set(CLASSICS.map((c) => c.short)).size).toBe(CLASSICS.length);
    for (const c of CLASSICS) {
      expect(c.short.length, c.id).toBeLessThanOrEqual(10);
      expect(c.about.length, c.id).toBeGreaterThan(20);
      expect(c.variants.length, `${c.id} has variants`).toBeGreaterThanOrEqual(2);
      expect(new Set(c.variants.map((v) => v.name)).size, `${c.id} variant names are unique`).toBe(c.variants.length);
      for (const v of c.variants) {
        const where = `${c.id} / ${v.name}`;
        const bpm = v.bpm ?? c.bpm;
        const swing = v.swing ?? c.swing;
        expect(bpm, where).toBeGreaterThanOrEqual(60);
        expect(bpm, where).toBeLessThanOrEqual(200);
        expect(swing, where).toBeGreaterThanOrEqual(50);
        expect(swing, where).toBeLessThanOrEqual(75);
        const parts = Object.entries(v.parts);
        expect(parts.length, where).toBeGreaterThan(0);
        const longest = Math.max(...parts.map(([, s]) => s!.length));
        for (const [role, part] of parts) {
          expect(ROLES as readonly string[], where).toContain(role);
          expect([16, 32, 64], `${where} ${role} length`).toContain(part!.length);
          expect(longest % part!.length, `${where} ${role} repeats evenly`).toBe(0);
          expect(part, `${where} ${role}`).toMatch(/^[Xxg.rRtuql]+$/);
          expect(part, `${where} ${role} has a hit`).toMatch(/[^.]/);
          // Triplet marks sit on the triplet grid: t on the last 16th of a beat, u and q on the second.
          [...part!].forEach((ch, i) => {
            if (ch === 't') expect(i % 4, `${where} ${role} t at ${i}`).toBe(3);
            if (ch === 'u' || ch === 'q') expect(i % 4, `${where} ${role} ${ch} at ${i}`).toBe(1);
          });
        }
      }
    }
  });

  it('loads the Amen break exactly, four bars, every time', () => {
    const p = newProject();
    const a = loadClassic(p, { classicId: 'amen', variant: 0, tempo: true });
    const b = loadClassic(p, { classicId: 'amen', variant: 0, tempo: true });
    expect(a).toEqual(b);
    const v = classicById('amen').variants[0];
    expect(grid(a, KICK)).toBe(onOff(v.parts.kick!));
    expect(grid(a, SNARE)).toBe(onOff(v.parts.snare!));
    expect(grid(a, RIDE)).toBe(onOff(v.parts.ride!));
    expect(grid(a, CRASH)).toBe(onOff(v.parts.crash!));
    expect(grid(a, KICK).length).toBe(64);
    expect(a.bpm).toBe(136);
    expect(a.swing).toBe(50);
    // Ghost notes are quiet, backbeats are loud.
    const snare = currentPattern(a).lanes[SNARE].steps;
    expect(snare[4].velocity).toBeGreaterThan(0.9);
    expect(snare[7].velocity).toBeLessThan(0.5);
  });

  it('uses the variant tempo, or leaves the tempo alone', () => {
    const p = newProject();
    expect(loadClassic(p, { classicId: 'amen', variant: 3, tempo: true }).bpm).toBe(165);
    expect(loadClassic(p, { classicId: 'funky-drummer', variant: 3, tempo: true }).swing).toBe(56);
    const kept = loadClassic(p, { classicId: 'amen', variant: 3, tempo: false });
    expect([kept.bpm, kept.swing]).toEqual([p.bpm, p.swing]);
  });

  it('clears tracks the beat does not use and keeps locked steps', () => {
    let p = newProject();
    p = setStep(p, p.currentPatternId, 't12', 3, { on: true });
    p = setStep(p, p.currentPatternId, KICK, 5, { on: true, locked: true });
    const a = loadClassic(p, { classicId: 'boom-bap', variant: 0, tempo: true });
    expect(grid(a, 't12')).not.toContain('x');
    expect(currentPattern(a).lanes[KICK].steps[5]).toMatchObject({ on: true, locked: true });
  });

  it('never plays a closed and open hat on the same step', () => {
    for (const c of CLASSICS) {
      for (let i = 0; i < c.variants.length; i++) {
        const a = loadClassic(newProject(), { classicId: c.id, variant: i, tempo: true });
        const h = grid(a, HAT);
        const o = grid(a, OPENHAT);
        for (let s = 0; s < Math.min(h.length, o.length); s++) expect(h[s] === 'x' && o[s] === 'x', `${c.id} ${i} step ${s}`).toBe(false);
      }
    }
  });

  it('writes rolls, ghost notes and triplet timing into the steps', () => {
    const roll = currentPattern(loadClassic(newProject(), { classicId: 'amen', variant: 3, tempo: true })).lanes[SNARE].steps;
    expect(roll[62].ratchet).toBe(2);
    expect(roll[63].ratchet).toBe(3);
    const purdie = currentPattern(loadClassic(newProject(), { classicId: 'purdie', variant: 0, tempo: true }));
    expect(purdie.lanes[HAT].steps[3].micro).toBeCloseTo(-0.33);
    expect(purdie.lanes[SNARE].steps[1].micro).toBeCloseTo(0.33);
    expect(purdie.lanes[SNARE].steps[1].velocity).toBeLessThan(0.5);
    expect(classicHits('X.g.')).toEqual([{ velocity: 0.95, ratchet: 1, micro: 0 }, null, { velocity: 0.36, ratchet: 1, micro: 0 }, null]);
  });

  it('wraps variant numbers round', () => {
    const c = classicById('apache');
    expect(classicVariant(c, c.variants.length)).toBe(c.variants[0]);
    expect(classicVariant(c, -1)).toBe(c.variants[c.variants.length - 1]);
  });

  it('every variant loads and plays on the factory kit', () => {
    for (const c of CLASSICS) {
      for (let i = 0; i < c.variants.length; i++) {
        const a = loadClassic(newProject(), { classicId: c.id, variant: i, tempo: true });
        const hits = a.tracks.reduce((n, t) => n + grid(a, t.id).split('x').length - 1, 0);
        expect(hits, `${c.id} ${c.variants[i].name}`).toBeGreaterThan(0);
      }
    }
  });

  it('adds every variant as its own pattern, named after the beat', () => {
    const p = newProject();
    const before = p.patterns.length;
    const { project: a, added } = addClassicPatterns(p, { classicId: 'amen', tempo: true });
    const c = classicById('amen');
    expect(added.length).toBe(c.variants.length);
    expect(a.patterns.length).toBe(before + c.variants.length);
    expect(added.map((id) => a.patterns.find((x) => x.id === id)!.name)).toEqual(c.variants.map((_, i) => `Amen ${i + 1}`));
    expect(a.currentPatternId).toBe(added[0]);
    // In order, right after the pattern that was current.
    const at = a.patterns.findIndex((x) => x.id === p.currentPatternId);
    expect(a.patterns.slice(at + 1, at + 1 + added.length).map((x) => x.id)).toEqual(added);
    added.forEach((id, i) => expect(grid(a, KICK, id)).toBe(onOff(c.variants[i].parts.kick!)));
    // The original pattern is untouched.
    expect(grid(a, KICK, p.currentPatternId)).toBe(grid(p, KICK));
  });

  it('survives saving and loading', () => {
    const { project } = addClassicPatterns(newProject(), { classicId: 'soul-pride', tempo: true });
    const back = parseProject(serializeProject(project));
    expect(back.patterns.map((x) => x.name)).toEqual(project.patterns.map((x) => x.name));
    expect(back.patterns.map((x) => x.lanes)).toEqual(project.patterns.map((x) => x.lanes));
  });

  it('loaded breaks read as their kind of music', () => {
    const a = loadClassic(newProject(), { classicId: 'two-step', variant: 0, tempo: true });
    expect(detectStyle(a)[0].style.genre).toBe('Drum & bass');
  });
});

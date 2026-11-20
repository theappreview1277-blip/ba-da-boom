import { describe, expect, it } from 'vitest';
import { newProject } from '../src/model/defaults';
import { setStep } from '../src/model/ops';
import { CLASSICS } from '../src/model/classics';
import { STYLES } from '../src/model/styles';
import { roleTracks } from '../src/model/rhythm';
import {
  BLOCK_BARS,
  FORMS,
  arrange,
  arrangedKind,
  autoForm,
  buildTrack,
  clampBars,
  planSections,
  retakeSection,
  songSections,
  type ArrangeOptions,
} from '../src/model/arrange';
import { parseProject, serializeProject } from '../src/model/serialize';
import { MAX_STEPS, STEPS_PER_BAR, type Pattern, type Project } from '../src/model/types';

const opts = (o: Partial<ArrangeOptions> = {}): ArrangeOptions => ({
  source: { kind: 'style', styleId: 'dnb-twostep' },
  form: 'auto',
  length: 'normal',
  fills: 'phrases',
  complexity: 0.5,
  seed: 1,
  tempo: true,
  ...o,
});
const roles = (p: Project) => roleTracks(p);
const hits = (pt: Pattern, trackId: string | undefined, from = 0, to = MAX_STEPS) => (trackId ? pt.lanes[trackId].steps.slice(from, to).filter((s) => s.on).length : 0);
const lanesOnly = (pts: Pattern[]) => pts.map((pt) => ({ name: pt.name, lanes: pt.lanes }));
const named = (p: Project, name: string) => p.patterns.find((pt) => pt.name === name)!;

describe('track beat intelligence: whole-track arrangement', () => {
  it('every form at every length gives a song of whole 4-bar blocks that adds up to its sections', () => {
    for (const form of FORMS)
      for (const length of ['short', 'normal', 'long'] as const) {
        const p = newProject();
        const { project, arrangement: a } = buildTrack(p, opts({ form: form.id, length }));
        const total = a.sections.reduce((n, s) => n + s.bars, 0);
        expect(project.song.reduce((n, e) => n + e.bars, 0)).toBe(total);
        expect(a.sections.every((s) => s.bars % BLOCK_BARS === 0 && s.bars >= 4)).toBe(true);
        expect(project.song.every((e) => e.bars % BLOCK_BARS === 0 && project.patterns.some((pt) => pt.id === e.patternId))).toBe(true);
        expect(a.patterns.every((pt) => Object.values(pt.lanes).every((l) => l.length === MAX_STEPS && l.steps.length === MAX_STEPS))).toBe(true);
        expect(new Set(a.patterns.map((pt) => pt.name)).size).toBe(a.patterns.length);
        expect(a.sections.map((s) => s.kind)).toEqual(form.sections.map((s) => s.kind));
      }
  });

  it('works for every style and every named beat', () => {
    const p = newProject();
    for (const s of STYLES) {
      const a = arrange(p, opts({ source: { kind: 'style', styleId: s.id } }));
      expect(a.patterns.some((pt) => Object.values(pt.lanes).some((l) => l.steps.some((x) => x.on)))).toBe(true);
    }
    for (const c of CLASSICS) {
      const a = arrange(p, opts({ source: { kind: 'classic', classicId: c.id } }));
      expect(a.song.length).toBeGreaterThan(0);
    }
  });

  it('is the same every time for the same seed, and different for another seed', () => {
    const p = newProject();
    const a = arrange(p, opts());
    const b = arrange(p, opts());
    expect(lanesOnly(b.patterns)).toEqual(lanesOnly(a.patterns));
    const c = arrange(p, opts({ seed: 5 }));
    expect(lanesOnly(c.patterns)).not.toEqual(lanesOnly(a.patterns));
  });

  it('picks a form that suits the music', () => {
    const p = newProject();
    expect(autoForm(p, { kind: 'style', styleId: 'dnb-twostep' }).id).toBe('dnb');
    expect(autoForm(p, { kind: 'style', styleId: 'house-classic' }).id).toBe('club');
    expect(autoForm(p, { kind: 'style', styleId: STYLES.find((s) => s.genre === 'Hip-hop')!.id }).id).toBe('hiphop');
    expect(autoForm(p, { kind: 'style', styleId: STYLES.find((s) => s.genre === 'Rock & metal')!.id }).id).toBe('song');
  });

  it('shapes each section: sparse intro, crash into the chorus, rising build, stripped break, ending outro', () => {
    const p = newProject();
    const r = roles(p);
    const { project, arrangement: a } = buildTrack(p, opts({ form: 'club' }));
    const intro = named(project, 'Intro');
    expect(hits(intro, r.snare) + hits(intro, r.clap)).toBe(0);
    expect(hits(intro, r.kick, 0, 2 * STEPS_PER_BAR)).toBe(0);
    expect(hits(intro, r.kick, 2 * STEPS_PER_BAR)).toBeGreaterThan(0);
    expect(hits(intro, r.hat) + hits(intro, r.ride) + hits(intro, r.shaker)).toBeGreaterThan(0);

    const dropIn = named(project, 'Drop in');
    expect(dropIn.lanes[r.crash!].steps[0].on).toBe(true);
    expect(hits(dropIn, r.crash)).toBe(1);
    expect(hits(dropIn, r.kick)).toBeGreaterThan(0);

    const b1 = named(project, 'Build 1');
    const b2 = named(project, 'Build 2');
    const snare = r.snare!;
    const perBar = [b1, b2].flatMap((pt) => [0, 1, 2, 3].map((bar) => hits(pt, snare, bar * 16, bar * 16 + 16)));
    for (let i = 1; i < perBar.length - 1; i++) expect(perBar[i]).toBeGreaterThanOrEqual(perBar[i - 1]);
    expect(perBar[perBar.length - 2]).toBeGreaterThan(perBar[0]);
    const vel = b2.lanes[snare].steps.filter((s) => s.on).map((s) => s.velocity);
    expect(vel[vel.length - 1]).toBeGreaterThan(b1.lanes[snare].steps.find((s) => s.on)!.velocity);
    expect(b2.lanes[snare].steps.slice(48).some((s) => s.ratchet > 1)).toBe(true);
    expect(hits(b2, r.hat, 48)).toBe(0);

    const brk = named(project, 'Breakdown');
    expect(hits(brk, r.kick) + hits(brk, r.snare)).toBe(0);
    expect(Object.values(brk.lanes).some((l) => l.steps.some((s) => s.on))).toBe(true);

    const end = named(project, 'Outro end');
    const lastBar = Object.entries(end.lanes).filter(([, l]) => l.steps.slice(48).some((s) => s.on));
    expect(lastBar.map(([id]) => id).sort()).toEqual([r.kick!, r.crash!].sort());
    expect(project.song[project.song.length - 1].patternId).toBe(end.id);
    expect(a.sections[a.sections.length - 1].kind).toBe('outro');
  });

  it('puts fills where sections change and turnarounds every 8 bars, or none when asked', () => {
    const p = newProject();
    const withFills = buildTrack(p, opts({ form: 'song' })).project;
    const names = withFills.song.map((e) => withFills.patterns.find((pt) => pt.id === e.patternId)!.name);
    expect(names.filter((n) => /fill/.test(n)).length).toBeGreaterThanOrEqual(6);
    expect(names.some((n) => /turn/.test(n))).toBe(true);
    // Fills change the end of the pattern, not the start.
    const verse = named(withFills, 'Verse');
    const verseFill = withFills.patterns.find((pt) => pt.name.startsWith('Verse fill'))!;
    for (const id of Object.keys(verse.lanes)) expect(verseFill.lanes[id].steps.slice(0, 48)).toEqual(verse.lanes[id].steps.slice(0, 48));
    expect(JSON.stringify(verseFill.lanes)).not.toBe(JSON.stringify(verse.lanes));

    const sectionsOnly = buildTrack(p, opts({ form: 'song', fills: 'sections' })).project;
    expect(sectionsOnly.patterns.some((pt) => /turn/.test(pt.name))).toBe(false);
    expect(sectionsOnly.patterns.some((pt) => /fill/.test(pt.name))).toBe(true);

    const none = buildTrack(p, opts({ form: 'song', fills: 'off' })).project;
    expect(none.patterns.some((pt) => /fill|turn/.test(pt.name))).toBe(false);
  });

  it('uses the groove: a named beat gives a calmer verse and a busier chorus, and your own pattern is used as it is', () => {
    const p = newProject();
    const amen = CLASSICS.find((c) => c.id === 'amen')!;
    const a = buildTrack(p, opts({ source: { kind: 'classic', classicId: amen.id }, form: 'song', fills: 'off' })).project;
    const count = (pt: Pattern) => Object.values(pt.lanes).reduce((n, l) => n + l.steps.filter((s) => s.on).length, 0);
    expect(count(named(a, 'Chorus in'))).toBeGreaterThan(count(named(a, 'Verse in')) - 1);
    expect(a.bpm).toBe(amen.bpm);

    // The starter beat of a new project: four kicks, two snares, hats.
    const own = buildTrack(p, opts({ source: { kind: 'pattern', patternId: p.currentPatternId }, form: 'song', fills: 'off', tempo: true })).project;
    expect(own.bpm).toBe(p.bpm);
    const verse = named(own, 'Verse');
    const r = roles(p);
    expect(verse.lanes[r.kick!].steps.slice(0, 16).map((s) => s.on)).toEqual(p.patterns[0].lanes[r.kick!].steps.slice(0, 16).map((s) => s.on));
    expect(hits(verse, r.kick)).toBe(16);
    expect(hits(verse, r.snare)).toBe(8);
  });

  it('building again replaces the built track but keeps your own patterns', () => {
    let p = newProject();
    p = setStep(p, p.patterns[1].id, 't1', 0, { on: true });
    const first = buildTrack(p, opts()).project;
    const n = first.patterns.length;
    expect(first.patterns.slice(0, 4).map((pt) => pt.id)).toEqual(p.patterns.map((pt) => pt.id));
    expect(first.songLoop).toBe(false);
    expect(first.bpm).toBe(174);
    const again = buildTrack(first, opts({ seed: 2 })).project;
    expect(again.patterns.length).toBe(n);
    expect(again.patterns.filter((pt) => !arrangedKind(pt.id)).map((pt) => pt.id)).toEqual(p.patterns.map((pt) => pt.id));
    expect(again.patterns[1].lanes.t1.steps[0].on).toBe(true);
    expect(again.song.every((e) => again.patterns.find((pt) => pt.id === e.patternId) && arrangedKind(e.patternId))).toBe(true);
  });

  it('a new take of one section changes only that section and keeps edits made elsewhere', () => {
    const p0 = newProject();
    const o = opts({ form: 'song' });
    let p = buildTrack(p0, o).project;
    const chorus = named(p, 'Chorus in');
    // An edit by hand in a verse pattern.
    const verse = named(p, 'Verse');
    p = setStep(p, verse.id, 't16', 5, { on: true });
    const { project: q, takes, whole } = retakeSection(p, o, 'chorus');
    expect(whole).toBe(false);
    expect(takes.chorus).toBe(1);
    expect(q.song).toEqual(p.song);
    expect(q.patterns.map((pt) => pt.id)).toEqual(p.patterns.map((pt) => pt.id));
    expect(named(q, 'Verse').lanes.t16.steps[5].on).toBe(true);
    expect(JSON.stringify(named(q, 'Chorus in').lanes)).not.toBe(JSON.stringify(chorus.lanes));
    for (const pt of q.patterns.filter((x) => arrangedKind(x.id) !== 'chorus')) expect(pt).toEqual(p.patterns.find((x) => x.id === pt.id));
    // The same takes give the same result as building with them.
    const built = buildTrack(p0, { ...o, takes }).project;
    expect(named(built, 'Chorus in').lanes).toEqual(named(q, 'Chorus in').lanes);
  });

  it('builds the sections you set, in 4-bar blocks', () => {
    expect(clampBars(5)).toBe(4);
    expect(clampBars(7)).toBe(8);
    expect(clampBars(500)).toBe(64);
    const p = newProject();
    const a = arrange(p, opts({ sections: [{ kind: 'intro', bars: 4 }, { kind: 'chorus', bars: 12 }, { kind: 'outro', bars: 4 }] }));
    expect(a.sections.map((s) => `${s.kind}${s.bars}`)).toEqual(['intro4', 'chorus12', 'outro4']);
    expect(a.song.reduce((n, e) => n + e.bars, 0)).toBe(20);
    expect(planSections(FORMS[0], 'short').every((s) => s.bars >= 4)).toBe(true);
  });

  it('shows the song as sections, and survives saving and opening', () => {
    const p = buildTrack(newProject(), opts({ form: 'dnb' })).project;
    const secs = songSections(p);
    expect(secs.map((s) => `${s.name}${s.bars}`)).toEqual(['Intro16', 'Build8', 'Drop32', 'Breakdown16', 'Build8', 'Drop32', 'Outro16']);
    const back = parseProject(serializeProject(p));
    expect(songSections(back)).toEqual(secs);
    expect(back.songLoop).toBe(false);
  });
});

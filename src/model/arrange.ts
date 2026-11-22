import { newId } from './defaults';
import { rng } from './generate';
import { classicById, type ClassicVariant } from './classics';
import {
  classicHits,
  detectStyle,
  fillLanes,
  renderPart,
  roleOf,
  roleTracks,
  styleById,
  styleTracks,
  unrollLane,
  type FillType,
  type Hit,
  type Role,
} from './rhythm';
import { MAX_SONG_BARS, MAX_STEPS, STEPS_PER_BAR, type Lane, type Pattern, type Project, type SongEntry, type Step } from './types';

// Track beat intelligence: a whole track's drums from one groove. The groove
// (a style, a named beat or one of the user's patterns) is turned into the
// sections of a song (intro, verses, choruses or drops, builds, breaks and an
// outro), with crashes where sections start and fills where they change.
//
// The result is ordinary patterns plus the song arrangement, so everything stays
// editable in the grid and plays and exports through the existing song mode.
// Like the other generators it is seeded: the same groove, form and seed always
// give the same track. Nothing here touches the DOM or the audio engine, so the
// same code can drive the plugin version later.

export const SECTION_KINDS = ['intro', 'verse', 'chorus', 'build', 'break', 'outro'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** Sections are made of 4-bar blocks (one pattern of 64 steps each). */
export const BLOCK_BARS = MAX_STEPS / STEPS_PER_BAR;

export interface Section {
  kind: SectionKind;
  /** A multiple of BLOCK_BARS, 4..64. */
  bars: number;
}

export interface Form {
  id: string;
  name: string;
  about: string;
  /** What the chorus and break are called in this kind of track. */
  names: Partial<Record<SectionKind, string>>;
  sections: Section[];
}

const S = (kind: SectionKind, bars: number): Section => ({ kind, bars });

export const FORMS: Form[] = [
  {
    id: 'song',
    name: 'Song (verse / chorus)',
    about: 'Intro, two verses and choruses, a break, a last long chorus and an outro.',
    names: {},
    sections: [S('intro', 8), S('verse', 16), S('chorus', 8), S('verse', 16), S('chorus', 8), S('break', 8), S('chorus', 16), S('outro', 8)],
  },
  {
    id: 'club',
    name: 'Club (build and drop)',
    about: 'Long DJ-friendly intro and outro, builds into two drops with a breakdown between.',
    names: { chorus: 'Drop', break: 'Breakdown', verse: 'Groove' },
    sections: [S('intro', 16), S('verse', 16), S('build', 8), S('chorus', 16), S('break', 16), S('build', 8), S('chorus', 16), S('outro', 16)],
  },
  {
    id: 'dnb',
    name: 'Drum & bass (two drops)',
    about: 'Intro, build, a long first drop, a breakdown, a second build and drop, then an outro.',
    names: { chorus: 'Drop', break: 'Breakdown' },
    sections: [S('intro', 16), S('build', 8), S('chorus', 32), S('break', 16), S('build', 8), S('chorus', 32), S('outro', 16)],
  },
  {
    id: 'hiphop',
    name: 'Hip-hop (verse / hook)',
    about: '16-bar verses and 8-bar hooks, with a bridge before the last hook.',
    names: { chorus: 'Hook', break: 'Bridge' },
    sections: [S('intro', 4), S('verse', 16), S('chorus', 8), S('verse', 16), S('chorus', 8), S('break', 8), S('chorus', 8), S('outro', 4)],
  },
  {
    id: 'short',
    name: 'Short track',
    about: 'A quick sketch of a whole track: about a minute at most tempos.',
    names: {},
    sections: [S('intro', 4), S('verse', 8), S('chorus', 8), S('break', 4), S('chorus', 8), S('outro', 4)],
  },
];

export const formById = (id: string): Form => FORMS.find((f) => f.id === id) ?? FORMS[0];

export const SECTION_NAMES: Record<SectionKind, string> = {
  intro: 'Intro',
  verse: 'Verse',
  chorus: 'Chorus',
  build: 'Build',
  break: 'Break',
  outro: 'Outro',
};

export const sectionName = (form: Form, kind: SectionKind) => form.names[kind] ?? SECTION_NAMES[kind];

export const LENGTHS = [
  { id: 'short', name: 'Short', scale: 0.5 },
  { id: 'normal', name: 'Normal', scale: 1 },
  { id: 'long', name: 'Long', scale: 1.5 },
] as const;
export type TrackLength = (typeof LENGTHS)[number]['id'];

export const FILL_PLANS = [
  { id: 'phrases', name: 'Every 8 bars and at changes' },
  { id: 'sections', name: 'Only where sections change' },
  { id: 'off', name: 'No fills' },
] as const;
export type FillPlan = (typeof FILL_PLANS)[number]['id'];

export type GrooveSource = { kind: 'style'; styleId: string } | { kind: 'classic'; classicId: string } | { kind: 'pattern'; patternId: string };

export interface ArrangeOptions {
  source: GrooveSource;
  /** A form id, or 'auto' to pick one that suits the groove. */
  form: string;
  length: TrackLength;
  fills: FillPlan;
  /** 0..1, for style grooves: extra hits, ghost notes and rolls. */
  complexity: number;
  seed: number;
  /** Also set the project tempo and swing to the groove's (styles and named beats). */
  tempo: boolean;
  /** The sections to build. When left out they come from the form and length. */
  sections?: Section[];
  /** Added to the seed for one kind of section, so it can get a new take on its own. */
  takes?: Partial<Record<SectionKind, number>>;
}

export const clampBars = (bars: number) => Math.max(BLOCK_BARS, Math.min(MAX_SONG_BARS, Math.round(bars / BLOCK_BARS) * BLOCK_BARS));

// --- choosing a form ---

/** The genre a groove belongs to, as far as it can be told. */
export function grooveGenre(p: Project, source: GrooveSource): string {
  if (source.kind === 'style') return styleById(source.styleId).genre;
  if (source.kind === 'classic') return classicById(source.classicId).category;
  const pattern = p.patterns.find((x) => x.id === source.patternId);
  return (pattern && detectStyle(p, pattern)[0]?.style.genre) || '';
}

function grooveBpm(p: Project, source: GrooveSource): number {
  if (source.kind === 'style') return styleById(source.styleId).bpm;
  if (source.kind === 'classic') return classicById(source.classicId).bpm;
  return p.bpm;
}

/** The form 'auto' stands for with this groove. */
export function autoForm(p: Project, source: GrooveSource): Form {
  const g = grooveGenre(p, source).toLowerCase();
  const bpm = grooveBpm(p, source);
  if (/drum & bass|jungle/.test(g) || (/break/.test(g) && bpm >= 150)) return formById('dnb');
  if (/hip-hop|trap|r&b/.test(g)) return formById('hiphop');
  if (/house|techno|garage|dubstep|electronic|break/.test(g)) return formById('club');
  if (!g && bpm >= 160) return formById('dnb');
  return formById('song');
}

export const resolveForm = (p: Project, o: Pick<ArrangeOptions, 'form' | 'source'>): Form => (o.form === 'auto' ? autoForm(p, o.source) : formById(o.form));

/** The sections of a form at a length. Builds stay at least 4 bars; everything stays in 4-bar blocks. */
export function planSections(form: Form, length: TrackLength): Section[] {
  const scale = LENGTHS.find((l) => l.id === length)?.scale ?? 1;
  return form.sections.map((s) => ({ kind: s.kind, bars: clampBars(s.kind === 'build' ? Math.max(4, s.bars * Math.min(1, scale)) : s.bars * scale) }));
}

export const sectionsFor = (p: Project, o: ArrangeOptions): Section[] =>
  (o.sections?.length ? o.sections : planSections(resolveForm(p, o), o.length)).map((s) => ({ kind: s.kind, bars: clampBars(s.bars) }));

// --- grooves ---

type Body = Record<string, Step[]>;

const hitStep = (h: Hit): Step => ({ on: true, velocity: h.velocity, probability: 1, micro: h.micro, ratchet: h.ratchet, locked: false });
const restStep = (): Step => ({ on: false, velocity: 0.8, probability: 1, micro: 0, ratchet: 1, locked: false });
const round2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Hits repeated (or cut) to one block, as steps. */
const blockOf = (hits: (Hit | null)[]): Step[] => Array.from({ length: MAX_STEPS }, (_, i) => (hits.length && hits[i % hits.length] ? hitStep(hits[i % hits.length]!) : restStep()));

function emptyBody(p: Project): Body {
  return Object.fromEntries(p.tracks.map((t) => [t.id, Array.from({ length: MAX_STEPS }, restStep)]));
}

function rolesToBody(p: Project, map: Partial<Record<Role, string>>, hitsFor: (role: Role) => (Hit | null)[] | null): Body {
  const body = emptyBody(p);
  for (const [role, trackId] of Object.entries(map) as [Role, string][]) {
    const hits = hitsFor(role);
    if (hits) body[trackId] = blockOf(hits);
  }
  // Closed and open hats on the same step would cut each other: the open hat wins.
  if (map.hat && map.openhat) body[map.hat] = body[map.hat].map((s, i) => (s.on && body[map.openhat!][i].on ? restStep() : s));
  return body;
}

const hitCount = (v: ClassicVariant) => Object.values(v.parts).reduce((n, part) => n + [...(part ?? '')].filter((c) => c !== '.').length, 0);

/**
 * The verse and chorus grooves. A style gives a calmer verse and a busier
 * chorus (more of its extra hits, and a different pick of its alternatives).
 * A named beat gives one of its calmer variants for the verse and one of its
 * busier ones for the chorus. A pattern of the user's is used as it is.
 */
function grooves(p: Project, o: ArrangeOptions): { verse: Body; chorus: Body } {
  const take = (k: SectionKind) => o.seed + (o.takes?.[k] ?? 0) * 7919;
  if (o.source.kind === 'style') {
    const style = styleById(o.source.styleId);
    const map = styleTracks(p, style);
    const c = clamp(o.complexity, 0, 1);
    return {
      verse: rolesToBody(p, map, (r) => renderPart(style, r, c * 0.7, take('verse'))),
      chorus: rolesToBody(p, map, (r) => renderPart(style, r, Math.min(1, c + 0.25), take('chorus') + 1)),
    };
  }
  if (o.source.kind === 'classic') {
    const c = classicById(o.source.classicId);
    const sorted = c.variants.map((v, i) => ({ v, i, n: hitCount(v) })).sort((a, b) => a.n - b.n || a.i - b.i);
    const half = Math.ceil(sorted.length / 2);
    const pick = (from: number, to: number, seed: number) => sorted[from + Math.floor(rng((seed * 2654435761 + 5) >>> 0)() * Math.max(1, to - from))].v;
    const verse = pick(0, half, take('verse'));
    const busy = sorted.length > 1 ? pick(sorted.length > 2 ? half : 1, sorted.length, take('chorus') + 1) : verse;
    const chorus = busy === verse && sorted.length > 1 ? sorted[sorted.length - 1].v : busy;
    const body = (v: ClassicVariant) => rolesToBody(p, styleTracks(p, v), (r) => (v.parts[r] ? classicHits(v.parts[r]!) : null));
    return { verse: body(verse), chorus: body(chorus) };
  }
  const source = o.source;
  const pattern = p.patterns.find((x) => x.id === source.patternId) ?? p.patterns[0];
  const body = emptyBody(p);
  for (const t of p.tracks) {
    const lane = pattern.lanes[t.id];
    if (!lane) continue;
    const unrolled = unrollLane(lane, MAX_STEPS);
    body[t.id] = Array.from({ length: MAX_STEPS }, (_, i) => ({ ...(i < unrolled.length ? unrolled.steps[i] : lane.steps[i % lane.length]), locked: false }));
  }
  // The chorus of a user's pattern: the same beat, a little harder, with the hats opening up at the end of each bar.
  const roles = roleTracks(p);
  const chorus: Body = Object.fromEntries(Object.entries(body).map(([id, steps]) => [id, steps.map((s) => (s.on ? { ...s, velocity: round2(clamp(s.velocity + 0.06, 0, 1)) } : s))]));
  if (roles.openhat && roles.hat && body[roles.hat].some((s) => s.on) && !body[roles.openhat].some((s) => s.on)) {
    for (let bar = 0; bar < BLOCK_BARS; bar++) {
      const i = bar * STEPS_PER_BAR + 14;
      chorus[roles.openhat][i] = { ...restStep(), on: true, velocity: 0.7 };
      chorus[roles.hat][i] = restStep();
    }
  }
  return { verse: body, chorus };
}

// --- shaping a block for its section ---

const TIMEKEEPERS: Role[] = ['hat', 'openhat', 'shaker', 'ride'];
const PERCUSSION: Role[] = ['shaker', 'conga', 'cowbell', 'clave', 'rim', 'ride'];

interface Ctx {
  p: Project;
  roles: Partial<Record<Role, string>>;
  roleOf: Map<string, Role | null>;
}

function shape(body: Body, ctx: Ctx, fn: (steps: Step[], role: Role | null, id: string) => Step[]): Body {
  return Object.fromEntries(Object.entries(body).map(([id, steps]) => [id, fn(steps.map((s) => ({ ...s })), ctx.roleOf.get(id) ?? null, id)]));
}

const silence = (steps: Step[], from = 0, to = MAX_STEPS) => steps.map((s, i) => (i >= from && i < to && s.on ? restStep() : s));
const softer = (steps: Step[], f: number) => steps.map((s) => (s.on ? { ...s, velocity: round2(clamp(s.velocity * f, 0.1, 1)) } : s));
const anyHits = (steps: Step[]) => steps.some((s) => s.on);

function addCrash(body: Body, ctx: Ctx, at = 0): Body {
  const id = ctx.roles.crash;
  if (!id || !body[id]) return body;
  const steps = body[id].slice();
  steps[at] = { ...restStep(), on: true, velocity: 0.9 };
  return { ...body, [id]: steps };
}

/** Intro: the hats (or other timekeepers) alone for two bars, then the kick comes in. No backbeat yet. */
function introBlock(verse: Body, ctx: Ctx, first: boolean): Body {
  const hasTime = Object.entries(verse).some(([id, s]) => TIMEKEEPERS.includes(ctx.roleOf.get(id)!) && anyHits(s));
  let out = shape(verse, ctx, (steps, role) => {
    if (role === 'kick') return first && hasTime ? silence(steps, 0, 2 * STEPS_PER_BAR) : steps;
    if (role && (TIMEKEEPERS.includes(role) || (!first && PERCUSSION.includes(role)))) return softer(steps, 0.9);
    return silence(steps);
  });
  if (!hasTime && ctx.roles.hat) {
    // A groove with no hats still needs something to count in with.
    out = { ...out, [ctx.roles.hat]: out[ctx.roles.hat].map((s, i) => (i % 4 === 0 ? { ...restStep(), on: true, velocity: i % 16 === 0 ? 0.7 : 0.55 } : s)) };
  }
  return out;
}

/** Break: kick and backbeat drop out; the hats and percussion carry on, a little softer. */
function breakBlock(verse: Body, ctx: Ctx): Body {
  let out = shape(verse, ctx, (steps, role) => (role && (TIMEKEEPERS.includes(role) || PERCUSSION.includes(role)) ? softer(steps, 0.8) : silence(steps)));
  if (!Object.values(out).some(anyHits)) {
    const id = ctx.roles.ride ?? ctx.roles.hat ?? ctx.roles.shaker;
    if (id) out = { ...out, [id]: out[id].map((s, i) => (i % 4 === 0 ? { ...restStep(), on: true, velocity: 0.55 } : s)) };
  }
  return out;
}

/**
 * Build: the snare (or clap) gets faster bar by bar, from quarters through 8ths
 * to 16ths and rolls, getting louder all the way, over a steady kick. The hats
 * fall away in the last bar and the very last 8th is left empty, so the next
 * section lands hard. `part` is which block of the build this is (0-based) of `of`.
 */
function buildBlock(verse: Body, ctx: Ctx, part: number, of: number): Body {
  const snare = ctx.roles.snare ?? ctx.roles.clap;
  const kick = ctx.roles.kick;
  const totalBars = of * BLOCK_BARS;
  const spacingAt = (bar: number) => {
    const f = bar / Math.max(1, totalBars - 1);
    return f < 0.3 ? 4 : f < 0.6 ? 2 : 1;
  };
  const last = part === of - 1;
  return shape(verse, ctx, (steps, role, id) => {
    if (id === snare) {
      return steps.map((_, i) => {
        const bar = part * BLOCK_BARS + Math.floor(i / STEPS_PER_BAR);
        const spacing = spacingAt(bar);
        const pos = (part * MAX_STEPS + i) / (of * MAX_STEPS);
        if (last && i >= MAX_STEPS - 2) return restStep();
        if (i % spacing !== 0) return restStep();
        const roll = last && i >= MAX_STEPS - STEPS_PER_BAR / 2 ? 2 : 1;
        return { ...restStep(), on: true, velocity: round2(clamp(0.4 + 0.58 * pos, 0.3, 1)), ratchet: roll };
      });
    }
    if (id === kick) return steps.map((_, i) => (i % 4 === 0 && !(last && i >= MAX_STEPS - 2) ? { ...restStep(), on: true, velocity: 0.9 } : restStep()));
    if (role && TIMEKEEPERS.includes(role)) return last ? silence(softer(steps, 0.8), MAX_STEPS - STEPS_PER_BAR) : softer(steps, 0.8);
    return silence(steps);
  });
}

/** Outro: the backbeat goes first, then the kick; the last bar is one crash and kick, then silence. */
function outroBlock(verse: Body, ctx: Ctx, last: boolean): Body {
  let out = shape(verse, ctx, (steps, role) => {
    if (!last) return softer(steps, 0.9);
    if (role === 'kick') return silence(steps, 2 * STEPS_PER_BAR + 1);
    if (role && TIMEKEEPERS.includes(role)) return silence(softer(steps, 0.8), 3 * STEPS_PER_BAR);
    return silence(steps);
  });
  if (last) {
    const end = 3 * STEPS_PER_BAR;
    const crash = ctx.roles.crash;
    if (crash) out = { ...out, [crash]: out[crash].map((s, i) => (i === end ? { ...restStep(), on: true, velocity: 0.95 } : s)) };
    if (ctx.roles.kick) out = { ...out, [ctx.roles.kick]: out[ctx.roles.kick].map((s, i) => (i === end ? { ...restStep(), on: true, velocity: 0.95 } : s)) };
  }
  return out;
}

// --- fills between sections ---

interface FillSpec {
  type: Exclude<FillType, 'auto'>;
  steps: number;
  intensity: number;
}

/** The fill at the end of a section, chosen by what comes next. */
function transitionFill(next: SectionKind | null, ctx: Ctx, seed: number): FillSpec | null {
  if (!next) return null;
  const toms = !!(ctx.roles.tomhigh || ctx.roles.tommid || ctx.roles.tomlow);
  const flip = rng((seed * 40503 + 17) >>> 0)() < 0.5;
  switch (next) {
    case 'chorus':
      return { type: toms && flip ? 'toms' : 'roll', steps: 8, intensity: 0.8 };
    case 'verse':
      return { type: toms && !flip ? 'toms' : 'roll', steps: 4, intensity: 0.55 };
    case 'break':
      return { type: 'break', steps: 4, intensity: 0.6 };
    case 'build':
      return { type: 'roll', steps: 4, intensity: 0.4 };
    case 'outro':
      return { type: toms ? 'toms' : 'roll', steps: 8, intensity: 0.6 };
    default:
      return { type: 'roll', steps: 4, intensity: 0.5 };
  }
}

const turnaround = (seed: number, ctx: Ctx): FillSpec => {
  const toms = !!(ctx.roles.tomhigh || ctx.roles.tommid || ctx.roles.tomlow);
  const r = rng((seed * 69069 + 3) >>> 0)();
  return { type: toms && r < 0.35 ? 'toms' : r < 0.7 ? 'roll' : 'build', steps: 4, intensity: 0.4 };
};

function withFill(body: Body, ctx: Ctx, f: FillSpec, seed: number): Body {
  const lanes = Object.fromEntries(Object.entries(body).map(([id, steps]) => [id, { length: MAX_STEPS, steps } as Lane]));
  const changed = fillLanes(ctx.p, { id: 'fill', name: 'fill', lanes }, { type: f.type, steps: f.steps, intensity: f.intensity, seed });
  return { ...body, ...Object.fromEntries(Object.entries(changed).map(([id, l]) => [id, l.steps])) };
}

// --- the whole track ---

export interface ArrangedSection {
  kind: SectionKind;
  name: string;
  bars: number;
  /** First bar of the section, from 0. */
  start: number;
  /** Index of the section's first entry in the song. */
  entry: number;
  /** Number of song entries it takes. */
  entries: number;
}

export interface Arrangement {
  form: Form;
  sections: ArrangedSection[];
  patterns: Pattern[];
  song: SongEntry[];
  bpm: number;
  swing: number;
}

/** Patterns made by the track builder have ids starting with this, then the section kind. */
export const ARRANGED_PREFIX = 'arr-';
export const arrangedKind = (patternId: string): SectionKind | null => {
  if (!patternId.startsWith(ARRANGED_PREFIX)) return null;
  const kind = patternId.slice(ARRANGED_PREFIX.length).split('-')[0];
  return (SECTION_KINDS as readonly string[]).includes(kind) ? (kind as SectionKind) : null;
};

/** The whole track as patterns and song entries, without changing the project. */
export function arrange(p: Project, o: ArrangeOptions): Arrangement {
  const form = resolveForm(p, o);
  const sections = sectionsFor(p, o);
  const ctx: Ctx = { p, roles: roleTracks(p), roleOf: new Map(p.tracks.map((t) => [t.id, roleOf(t, p)])) };
  const { verse, chorus } = grooves(p, o);
  const take = (k: SectionKind) => o.seed + (o.takes?.[k] ?? 0) * 7919;

  // Each distinct block becomes one pattern; repeats of a section reuse its patterns.
  const patterns: Pattern[] = [];
  const byKey = new Map<string, Pattern>();
  const names = new Map<string, number>();
  const patternFor = (kind: SectionKind, key: string, label: string, make: () => Body): Pattern => {
    const k = `${kind}|${key}`;
    let pt = byKey.get(k);
    if (!pt) {
      const body = make();
      const lanes = Object.fromEntries(p.tracks.map((t) => [t.id, { length: MAX_STEPS, steps: body[t.id] } as Lane]));
      // Names stay different ("Chorus fill", "Chorus fill 2") so each pattern can be told apart.
      const base = `${sectionName(form, kind)}${label ? ` ${label}` : ''}`;
      const n = (names.get(base) ?? 0) + 1;
      names.set(base, n);
      pt = { id: newId(`${ARRANGED_PREFIX}${kind}`), name: n > 1 ? `${base} ${n}` : base, lanes };
      byKey.set(k, pt);
      patterns.push(pt);
    }
    return pt;
  };

  const song: SongEntry[] = [];
  const out: ArrangedSection[] = [];
  let bar = 0;
  sections.forEach((sec, si) => {
    const next = sections[si + 1]?.kind ?? null;
    const blocks = sec.bars / BLOCK_BARS;
    const entry = song.length;
    const seed = take(sec.kind);
    const crashIn = (sec.kind === 'chorus' || sec.kind === 'verse' || sec.kind === 'outro') && si > 0;
    const endFill = o.fills === 'off' || sec.kind === 'build' || (sec.kind === 'outro' && !next) ? null : transitionFill(next, ctx, seed + si);
    for (let b = 0; b < blocks; b++) {
      const first = b === 0;
      const lastBlock = b === blocks - 1;
      // Turnarounds at the end of each 8 bars; breaks keep their space and builds have their own shape.
      const turns = o.fills === 'phrases' && sec.kind !== 'break' && sec.kind !== 'build';
      const fill = lastBlock ? endFill : turns && b % 2 === 1 ? turnaround(seed, ctx) : null;
      const fillKey = fill ? `${fill.type}${fill.steps}:${fill.intensity}` : '';
      let base: string;
      let make: () => Body;
      let label: string;
      switch (sec.kind) {
        case 'intro': {
          const sparse = first;
          base = sparse ? 'a' : 'b';
          label = '';
          make = () => introBlock(verse, ctx, sparse);
          break;
        }
        case 'build':
          base = `${b}/${blocks}`;
          label = blocks > 1 ? String(b + 1) : '';
          make = () => buildBlock(verse, ctx, b, blocks);
          break;
        case 'break':
          base = 'a';
          label = '';
          make = () => breakBlock(verse, ctx);
          break;
        case 'outro': {
          const end = lastBlock && !next;
          base = end ? 'end' : 'a';
          label = end ? 'end' : '';
          make = () => outroBlock(verse, ctx, end);
          break;
        }
        default:
          base = 'a';
          label = '';
          make = () => (sec.kind === 'chorus' ? chorus : verse);
      }
      const crash = first && crashIn && !!ctx.roles.crash;
      const key = `${base}|${crash ? 'c' : ''}|${fillKey}`;
      const fillLabel = fill ? (lastBlock && fill === endFill ? 'fill' : 'turn') : '';
      const name = [label, crash ? 'in' : '', fillLabel].filter(Boolean).join(' ');
      const pt = patternFor(sec.kind, key, name, () => {
        let body = make();
        if (crash) body = addCrash(body, ctx);
        if (fill) body = withFill(body, ctx, fill, lastBlock ? seed + si : seed);
        return body;
      });
      const prev = song[song.length - 1];
      if (prev && song.length > entry && prev.patternId === pt.id && prev.bars + BLOCK_BARS <= MAX_SONG_BARS) prev.bars += BLOCK_BARS;
      else song.push({ patternId: pt.id, bars: BLOCK_BARS });
    }
    out.push({ kind: sec.kind, name: sectionName(form, sec.kind), bars: sec.bars, start: bar, entry, entries: song.length - entry });
    bar += sec.bars;
  });

  let bpm = p.bpm;
  let swing = p.swing;
  if (o.tempo && o.source.kind === 'style') ({ bpm, swing } = styleById(o.source.styleId));
  if (o.tempo && o.source.kind === 'classic') ({ bpm, swing } = classicById(o.source.classicId));
  return { form, sections: out, patterns, song, bpm, swing };
}

/**
 * Build the whole track into the project: the patterns of an earlier built
 * track are replaced (with their song entries), the new patterns go at the end
 * of the pattern list, and the song becomes the new arrangement (no loop, so it
 * ends with the outro). The first pattern becomes the current one.
 */
export function buildTrack(p: Project, o: ArrangeOptions): { project: Project; arrangement: Arrangement } {
  const a = arrange(p, o);
  const kept = p.patterns.filter((pt) => !arrangedKind(pt.id));
  const patterns = [...kept, ...a.patterns];
  return {
    project: { ...p, bpm: a.bpm, swing: a.swing, patterns, song: a.song, songLoop: false, currentPatternId: a.patterns[0]?.id ?? p.currentPatternId },
    arrangement: a,
  };
}

/**
 * A new take of one kind of section (every verse, say), keeping the rest of the
 * track and the song as they are, including edits made to other sections. The
 * patterns of that kind keep their ids, so the song still points at them.
 * When the track has changed shape since it was built, the whole track is built again.
 */
export function retakeSection(p: Project, o: ArrangeOptions, kind: SectionKind): { project: Project; takes: Partial<Record<SectionKind, number>>; whole: boolean } {
  const takes = { ...o.takes, [kind]: (o.takes?.[kind] ?? 0) + 1 };
  const a = arrange(p, { ...o, takes });
  const mine = p.patterns.filter((pt) => arrangedKind(pt.id) === kind);
  const fresh = a.patterns.filter((pt) => arrangedKind(pt.id) === kind);
  const byName = new Map(mine.map((pt) => [pt.name, pt]));
  if (!mine.length || mine.length !== fresh.length || fresh.some((pt) => !byName.has(pt.name))) {
    return { project: buildTrack(p, { ...o, takes }).project, takes, whole: true };
  }
  const lanes = new Map(fresh.map((pt) => [byName.get(pt.name)!.id, pt.lanes]));
  return { project: { ...p, patterns: p.patterns.map((pt) => (lanes.has(pt.id) ? { ...pt, lanes: lanes.get(pt.id)! } : pt)) }, takes, whole: false };
}

/** The song as sections, for the timeline: song entries in a row from the same kind of section join up. */
export function songSections(p: Project): { kind: SectionKind | null; name: string; bars: number; start: number; entry: number; entries: number }[] {
  const names = new Map(p.patterns.map((pt) => [pt.id, pt.name]));
  const out: { kind: SectionKind | null; name: string; bars: number; start: number; entry: number; entries: number }[] = [];
  let bar = 0;
  p.song.forEach((e, i) => {
    const kind = arrangedKind(e.patternId);
    const prev = out[out.length - 1];
    const name = names.get(e.patternId) ?? '';
    if (!prev || kind === null || prev.kind !== kind) out.push({ kind, name: kind ? name.split(' ')[0] : name, bars: e.bars, start: bar, entry: i, entries: 1 });
    else {
      prev.bars += e.bars;
      prev.entries += 1;
    }
    bar += e.bars;
  });
  return out;
}

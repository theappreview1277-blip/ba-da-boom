import { rng } from './generate';
import { currentPattern, duplicatePattern } from './ops';
import { classicById, type Classic, type ClassicVariant } from './classics';
import { STYLES, type Style } from './styles';
import { MAX_STEPS, STEPS_PER_BAR, type Lane, type Pattern, type Project, type Step, type Track } from './types';

// Beat intelligence: style-aware beat generation, beat completion, fills and
// humanise. Like the other generators, everything here is seeded (the same seed
// and settings always give the same result), writes into the grid so the result
// stays editable, and never touches locked steps. Nothing needs the internet.

// --- what each track plays ---

export const ROLES = [
  'kick',
  'snare',
  'clap',
  'rim',
  'hat',
  'openhat',
  'tomlow',
  'tommid',
  'tomhigh',
  'cowbell',
  'clave',
  'shaker',
  'crash',
  'ride',
  'conga',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_NAMES: Record<Role, string> = {
  kick: 'Kick',
  snare: 'Snare',
  clap: 'Clap',
  rim: 'Rim',
  hat: 'Closed hat',
  openhat: 'Open hat',
  tomlow: 'Low tom',
  tommid: 'Mid tom',
  tomhigh: 'High tom',
  cowbell: 'Cowbell',
  clave: 'Clave',
  shaker: 'Shaker',
  crash: 'Crash',
  ride: 'Ride',
  conga: 'Conga',
};

// Checked in order, so "open hat" wins over "hat" and toms are told apart.
const ROLE_PATTERNS: [Role, RegExp][] = [
  ['openhat', /open\s*-?\s*h(i-?)?hat|\bopen\b.*\bhat|\bhat\s*-?\s*open|\boh\b|\bohh\b/],
  ['tomlow', /\b(low|lo|floor)\s*-?\s*tom|\btom\s*-?\s*(low|lo|floor)\b|\blt\b/],
  ['tomhigh', /\b(high|hi)\s*-?\s*tom|\btom\s*-?\s*(high|hi)\b|\bht\b/],
  ['tommid', /tom|\bmt\b/],
  ['kick', /kick|\bbd\b|bass\s*drum|\bkik\b|\bkck\b/],
  ['snare', /snare|\bsd\b|\bsn\b|\bsnr\b/],
  ['clap', /clap|\bcp\b|\bclp\b/],
  ['rim', /rim|stick|\brs\b/],
  ['hat', /hat|\bhh\b|\bch\b|\bchh\b/],
  ['crash', /crash|\bcr\b|cymbal|splash/],
  ['ride', /ride|\brd\b/],
  ['cowbell', /cow\s*-?\s*bell|\bcb\b|\bbell\b|agogo/],
  ['shaker', /shak|tamb|\bsh\b|\btb\b|maraca|cabasa/],
  ['conga', /conga|bongo|tumba|djembe/],
  ['clave', /clave|block|\bperc\b|\bcl\b|\bwood/],
];

function roleFromText(text: string): Role | null {
  const t = text.toLowerCase().replace(/[_]+/g, ' ');
  for (const [role, re] of ROLE_PATTERNS) if (re.test(t)) return role;
  return null;
}

/** What a track plays, from its name, then its sample's name. null if it can't be told. */
export function roleOf(track: Track, project: Pick<Project, 'samples'>): Role | null {
  const byName = roleFromText(track.name);
  if (byName) return byName;
  if (track.sound.source === 'synth') return track.sound.wave === 'sbd' ? 'kick' : null;
  const ref = track.sound.sampleId ? project.samples[track.sound.sampleId] : undefined;
  return roleFromText(`${ref?.name ?? ''} ${ref?.originalName ?? ''} ${track.sound.sampleId ?? ''}`);
}

/** The track for each role: the first track (in track order) that plays it. */
export function roleTracks(project: Project): Partial<Record<Role, string>> {
  const out: Partial<Record<Role, string>> = {};
  for (const t of project.tracks) {
    const r = roleOf(t, project);
    if (r && !out[r]) out[r] = t.id;
  }
  return out;
}

// When a style wants a sound the project has no track for, these stand in.
const STAND_INS: Partial<Record<Role, Role[]>> = {
  clap: ['snare'],
  snare: ['clap'],
  rim: ['clave', 'snare'],
  clave: ['rim', 'cowbell'],
  cowbell: ['clave'],
  ride: ['hat'],
  shaker: ['hat'],
  conga: ['tommid', 'tomhigh', 'tomlow'],
  tomlow: ['tommid', 'tomhigh'],
  tommid: ['tomlow', 'tomhigh'],
  tomhigh: ['tommid', 'tomlow'],
};

// --- styles ---

export { GENRES, STYLES, type Style } from './styles';

export const styleById = (id: string): Style => STYLES.find((s) => s.id === id) ?? STYLES[0];

const BASE_VELOCITY: Record<string, number> = { X: 0.95, x: 0.8, o: 0.7, g: 0.36, r: 0.78, t: 0.72 };
const TIMEKEEPERS: Role[] = ['hat', 'openhat', 'shaker', 'ride'];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Hash a role name into a salt, so each role draws its own numbers. */
const roleSalt = (r: string) => [...r].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export interface Hit {
  velocity: number;
  ratchet: number;
  /** Timing offset in steps (the swung 8th of a triplet feel). */
  micro: number;
}

/** One part as hits per step (null = rest), at the given complexity. */
export function renderPart(style: Style, role: Role, complexity: number, seed: number): (Hit | null)[] | null {
  const alts = style.parts[role];
  if (!alts?.length) return null;
  const rand = rng((seed * 2654435761 + roleSalt(style.id) * 97 + roleSalt(role)) >>> 0);
  const part = alts[Math.floor(rand() * alts.length) % alts.length];
  return [...part].map((c, i) => {
    // Draw the same numbers for every step, so complexity changes the result smoothly.
    const roll = rand();
    const vel = rand();
    if (c === '.') return null;
    const optional = c === 'o' || c === 'g';
    if (optional && roll >= complexity) return null;
    let v = BASE_VELOCITY[c] ?? 0.8;
    // Timekeepers lean on the beat and soften the in-between 16ths.
    if (TIMEKEEPERS.includes(role) && c !== 'X') v += i % 4 === 0 ? 0.06 : i % 2 === 1 ? -0.1 : 0;
    v = round2(clamp(v + (vel - 0.5) * 0.08, 0.15, 1));
    const ratchet = c === 'r' && roll < complexity ? (roll < complexity * 0.35 ? 3 : 2) : 1;
    return { velocity: v, ratchet, micro: c === 't' ? -0.33 : 0 };
  });
}

/** Repeat or cut a part to a length. */
function fit<T>(part: T[], length: number): T[] {
  return Array.from({ length }, (_, i) => part[i % part.length]);
}

/** Write hits into a lane: sets the length, leaves locked steps alone and resets what it writes. */
export function writeHits(lane: Lane, hits: (Hit | null)[]): Lane {
  const steps = lane.steps.map((s, i): Step => {
    if (i >= hits.length || s.locked) return s;
    const h = hits[i];
    return h ? { ...s, on: true, velocity: h.velocity, probability: 1, micro: h.micro, ratchet: h.ratchet } : s.on ? { ...s, on: false } : s;
  });
  return { length: Math.max(1, Math.min(MAX_STEPS, hits.length)), steps };
}

/** Turn off (unlocked) hits of `lane` where `other` plays, following each lane's own loop. */
function clearWhere(lane: Lane, other: Lane | undefined): Lane {
  if (!other) return lane;
  const steps = lane.steps.map((s, i) => (i < lane.length && s.on && !s.locked && other.steps[i % other.length].on ? { ...s, on: false } : s));
  return { ...lane, steps };
}

const hasHits = (lane: Lane | undefined) => !!lane && lane.steps.slice(0, lane.length).some((s) => s.on);

/** Which track plays each of the style's parts, using stand-ins when a sound is missing. */
export function styleTracks(project: Project, style: { parts: Partial<Record<Role, string | string[]>> }): Partial<Record<Role, string>> {
  const tracks = roleTracks(project);
  const out: Partial<Record<Role, string>> = {};
  const used = new Set<string>();
  const wanted = (Object.keys(style.parts) as Role[]).filter((r) => style.parts[r]?.length);
  // Direct matches first, so a stand-in never takes a track another part plays itself.
  for (const r of wanted) {
    const id = tracks[r];
    if (id) {
      out[r] = id;
      used.add(id);
    }
  }
  for (const r of wanted) {
    if (out[r]) continue;
    const sub = (STAND_INS[r] ?? []).map((s) => tracks[s]).find((id) => id && !used.has(id) && !wanted.includes(roleOf(project.tracks.find((t) => t.id === id)!, project)!));
    if (sub) {
      out[r] = sub;
      used.add(sub);
    }
  }
  return out;
}

export interface BeatOptions {
  styleId: string;
  /** 0..1: how many of the style's extra hits, ghost notes and rolls are written. */
  complexity: number;
  seed: number;
  /** Also set the project tempo and swing to the style's. */
  tempo: boolean;
}

/** The lanes of a beat in this style, by track id. */
function beatLanes(project: Project, pattern: Pattern, o: BeatOptions, only?: (trackId: string) => boolean) {
  const style = styleById(o.styleId);
  const map = styleTracks(project, style);
  const lanes: Record<string, (Hit | null)[]> = {};
  for (const [role, trackId] of Object.entries(map) as [Role, string][]) {
    if (only && !only(trackId)) continue;
    const hits = renderPart(style, role, o.complexity, o.seed);
    if (hits) lanes[trackId] = hits;
  }
  // All parts at the length of the longest, so they line up.
  const length = Math.max(0, ...Object.values(lanes).map((h) => h.length));
  for (const id of Object.keys(lanes)) lanes[id] = fit(lanes[id], length);
  return { style, lanes, map, length };
}

function setPatternLanes(p: Project, patternId: string, lanes: Record<string, Lane>): Project {
  return { ...p, patterns: p.patterns.map((pt) => (pt.id === patternId ? { ...pt, lanes: { ...pt.lanes, ...lanes } } : pt)) };
}

function withTempo(p: Project, style: Style, on: boolean): Project {
  return on ? { ...p, bpm: style.bpm, swing: style.swing } : p;
}

/**
 * A new beat in a style for the current pattern. Tracks the style uses get its
 * parts; every other track is cleared (locked steps are kept everywhere).
 */
export function generateBeat(p: Project, o: BeatOptions): Project {
  const pattern = currentPattern(p);
  const { style, lanes, map } = beatLanes(p, pattern, o);
  const length = Math.max(STEPS_PER_BAR, ...Object.values(lanes).map((h) => h.length));
  const out: Record<string, Lane> = {};
  for (const t of p.tracks) {
    const lane = pattern.lanes[t.id];
    out[t.id] = writeHits(lane, lanes[t.id] ? fit(lanes[t.id], length) : Array(length).fill(null));
  }
  // Closed and open hats on the same step would cut each other: the open hat wins.
  if (map.hat && map.openhat && out[map.hat] && out[map.openhat]) out[map.hat] = clearWhere(out[map.hat], out[map.openhat]);
  return withTempo(setPatternLanes(p, pattern.id, out), style, o.tempo);
}

/** Length of a pattern in steps: its longest lane that has hits (one bar if none do). */
export function patternSteps(p: Project, pattern: Pattern): number {
  const lens = p.tracks.map((t) => pattern.lanes[t.id]).filter(hasHits).map((l) => l.length);
  return lens.length ? Math.max(...lens) : STEPS_PER_BAR;
}

/**
 * Complete the current beat in a style: only tracks with no hits get the style's
 * parts, fitted to the pattern's length. Tracks the user has written stay as they are.
 */
export function completeBeat(p: Project, o: BeatOptions): { project: Project; filled: string[] } {
  const pattern = currentPattern(p);
  const length = patternSteps(p, pattern);
  const { style, lanes, map } = beatLanes(p, pattern, o, (id) => !hasHits(pattern.lanes[id]));
  const out: Record<string, Lane> = {};
  for (const [id, hits] of Object.entries(lanes)) out[id] = writeHits(pattern.lanes[id], fit(hits, length));
  // Closed and open hats never share a step. The one written now gives way to
  // the one already there; when both are new, the open hat wins.
  if (map.hat && map.openhat) {
    if (out[map.hat]) out[map.hat] = clearWhere(out[map.hat], out[map.openhat] ?? pattern.lanes[map.openhat]);
    else if (out[map.openhat]) out[map.openhat] = clearWhere(out[map.openhat], pattern.lanes[map.hat]);
  }
  const filled = p.tracks.filter((t) => out[t.id] && hasHits(out[t.id])).map((t) => t.id);
  if (!filled.length) return { project: p, filled };
  return { project: withTempo(setPatternLanes(p, pattern.id, out), style, o.tempo), filled };
}

// --- named beats (the classic beat library) ---

export { CATEGORIES, CLASSICS, VARIANT_COUNT, classicById, type Classic, type ClassicVariant } from './classics';

const CLASSIC_HIT: Record<string, { velocity: number; ratchet: number; micro: number }> = {
  X: { velocity: 0.95, ratchet: 1, micro: 0 },
  x: { velocity: 0.8, ratchet: 1, micro: 0 },
  g: { velocity: 0.36, ratchet: 1, micro: 0 },
  r: { velocity: 0.8, ratchet: 2, micro: 0 },
  R: { velocity: 0.85, ratchet: 3, micro: 0 },
  t: { velocity: 0.75, ratchet: 1, micro: -0.33 },
  u: { velocity: 0.8, ratchet: 1, micro: 0.33 },
  q: { velocity: 0.34, ratchet: 1, micro: 0.33 },
  l: { velocity: 0.9, ratchet: 1, micro: 0.12 },
};

/** One part of a named beat as hits per step (null = rest). Always the same: nothing is random. */
export function classicHits(part: string): (Hit | null)[] {
  return [...part].map((c) => (c === '.' ? null : { ...(CLASSIC_HIT[c] ?? CLASSIC_HIT.x) }));
}

export interface ClassicOptions {
  classicId: string;
  /** Index into the beat's variants. */
  variant: number;
  /** Also set the project tempo and swing to the variant's. */
  tempo: boolean;
}

/** A variant of a named beat, wrapping the index so stepping past either end comes round. */
export function classicVariant(c: Classic, index: number): ClassicVariant {
  const n = c.variants.length;
  return c.variants[((index % n) + n) % n];
}

export const classicTempo = (c: Classic, v: ClassicVariant) => ({ bpm: v.bpm ?? c.bpm, swing: v.swing ?? c.swing });

/** The lanes of a named beat variant for a pattern: tracks it doesn't use are cleared (locked steps kept). */
function classicLanes(p: Project, pattern: Pattern, v: ClassicVariant): Record<string, Lane> {
  const map = styleTracks(p, v);
  const hits: Record<string, (Hit | null)[]> = {};
  for (const [role, trackId] of Object.entries(map) as [Role, string][]) hits[trackId] = classicHits(v.parts[role]!);
  const length = Math.max(STEPS_PER_BAR, ...Object.values(hits).map((h) => h.length));
  const out: Record<string, Lane> = {};
  for (const t of p.tracks) out[t.id] = writeHits(pattern.lanes[t.id], hits[t.id] ? fit(hits[t.id], length) : Array(length).fill(null));
  // Closed and open hats on the same step would cut each other: the open hat wins.
  if (map.hat && map.openhat) out[map.hat] = clearWhere(out[map.hat], out[map.openhat]);
  return out;
}

function classicTempoOn(p: Project, c: Classic, v: ClassicVariant, on: boolean): Project {
  return on ? { ...p, ...classicTempo(c, v) } : p;
}

/** Write a named beat variant into the current pattern. */
export function loadClassic(p: Project, o: ClassicOptions): Project {
  const c = classicById(o.classicId);
  const v = classicVariant(c, o.variant);
  const pattern = currentPattern(p);
  return classicTempoOn(setPatternLanes(p, pattern.id, classicLanes(p, pattern, v)), c, v, o.tempo);
}

/**
 * Every variant of a named beat as new patterns after the current one, named
 * after the beat ("Amen 1", "Amen 2", ...). The first new pattern becomes the
 * current one. The tempo follows the first variant when asked.
 */
export function addClassicPatterns(p: Project, o: Omit<ClassicOptions, 'variant'>): { project: Project; added: string[] } {
  const c = classicById(o.classicId);
  let q = p;
  const added: string[] = [];
  for (const [i, v] of c.variants.entries()) {
    const dup = duplicatePattern(q, q.currentPatternId);
    if (dup === q) break;
    const id = dup.currentPatternId;
    const lanes = classicLanes(dup, currentPattern(dup), v);
    q = { ...dup, patterns: dup.patterns.map((pt) => (pt.id === id ? { ...pt, name: `${c.short} ${i + 1}`, lanes } : pt)) };
    added.push(id);
  }
  if (!added.length) return { project: p, added };
  q = { ...q, currentPatternId: added[0] };
  return { project: classicTempoOn(q, c, c.variants[0], o.tempo), added };
}

// --- style detection ---

/** Hits of a lane folded onto one bar of 16 steps, as a 0/1 array. */
function barProfile(lane: Lane): number[] {
  const out = Array(STEPS_PER_BAR).fill(0);
  for (let i = 0; i < lane.length; i++) if (lane.steps[i].on) out[i % STEPS_PER_BAR] = 1;
  return out;
}

/** The same for a style part (all alternatives and bars folded together), weighting optional hits less. */
function partProfile(part: string): number[] {
  const out = Array(STEPS_PER_BAR).fill(0);
  [...part].forEach((c, i) => {
    const w = c === '.' ? 0 : c === 'o' || c === 'g' ? 0.5 : 1;
    out[i % STEPS_PER_BAR] = Math.max(out[i % STEPS_PER_BAR], w);
  });
  return out;
}

/** Similarity of two weighted step sets, 0..1 (weighted Jaccard). */
function similarity(a: number[], b: number[]): number {
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < a.length; i++) {
    lo += Math.min(a[i], b[i]);
    hi += Math.max(a[i], b[i]);
  }
  return hi ? lo / hi : 1;
}

// Snare and clap both play the backbeat, so they are compared as one.
const DETECT_GROUPS: { roles: Role[]; weight: number }[] = [
  { roles: ['kick'], weight: 3 },
  { roles: ['snare', 'clap'], weight: 2.5 },
  { roles: ['hat'], weight: 1.5 },
  { roles: ['openhat'], weight: 1 },
  { roles: ['rim'], weight: 0.7 },
  { roles: ['shaker'], weight: 0.5 },
  { roles: ['clave'], weight: 0.7 },
  { roles: ['ride'], weight: 0.5 },
  { roles: ['conga'], weight: 0.7 },
  { roles: ['cowbell'], weight: 0.7 },
];

export interface StyleMatch {
  style: Style;
  /** 0..1 */
  score: number;
}

/**
 * Which styles the current pattern sounds like, best first. Compares the kick,
 * backbeat and hats with each style's parts, plus how close the tempo is.
 * Empty when the pattern has no kick, snare, clap or hat to go on.
 */
export function detectStyle(p: Project, pattern = currentPattern(p)): StyleMatch[] {
  const tracks = roleTracks(p);
  const user = DETECT_GROUPS.map((g) => {
    const lanes = g.roles.map((r) => (tracks[r] ? pattern.lanes[tracks[r]!] : undefined)).filter((l): l is Lane => hasHits(l));
    if (!lanes.length) return null;
    return lanes.map(barProfile).reduce((a, b) => a.map((v, i) => Math.max(v, b[i])));
  });
  if (!user.slice(0, 3).some(Boolean)) return [];
  return STYLES.map((style) => {
    let sum = 0;
    let weight = 0;
    DETECT_GROUPS.forEach((g, gi) => {
      const mine = user[gi];
      if (!mine) return;
      const parts = g.roles.flatMap((r) => style.parts[r] ?? []);
      // A sound the style doesn't use at all counts against it, gently.
      const best = parts.length ? Math.max(...parts.map((pt) => similarity(mine, partProfile(pt)))) : 0.1;
      sum += best * g.weight;
      weight += g.weight;
    });
    const groove = weight ? sum / weight : 0;
    const tempo = Math.exp(-Math.abs(p.bpm - style.bpm) / 25);
    return { style, score: round2(groove * 0.8 + tempo * 0.2) };
  }).sort((a, b) => b.score - a.score);
}

// --- fills ---

export const FILL_TYPES = [
  { id: 'auto', name: 'Auto' },
  { id: 'roll', name: 'Snare roll' },
  { id: 'toms', name: 'Tom run' },
  { id: 'build', name: 'Kick & snare build' },
  { id: 'break', name: 'Drop out' },
] as const;
export type FillType = (typeof FILL_TYPES)[number]['id'];

export interface FillOptions {
  type: FillType;
  /** Steps at the end of the pattern the fill takes: 4 (one beat), 8 (two beats) or 16 (one bar). */
  steps: number;
  /** 0..1: busier, louder towards the end, and with rolls near the top. */
  intensity: number;
  seed: number;
}

/** A lane unrolled to `length` steps by repeating it, so it sounds the same but can differ at the end. */
export function unrollLane(lane: Lane, length: number): Lane {
  if (lane.length >= length) return lane;
  const steps = lane.steps.map((s, i) => (i < length ? { ...lane.steps[i % lane.length] } : s));
  return { length, steps };
}

/** Resolve "auto" to a concrete fill for this project and seed. */
export function resolveFillType(p: Project, o: FillOptions): Exclude<FillType, 'auto'> {
  const tracks = roleTracks(p);
  const toms = (['tomhigh', 'tommid', 'tomlow'] as Role[]).filter((r) => tracks[r]);
  if (o.type === 'toms' && !toms.length) return 'roll';
  if (o.type !== 'auto') return o.type;
  const choices: Exclude<FillType, 'auto'>[] = toms.length ? ['roll', 'toms', 'build', 'toms'] : ['roll', 'build', 'roll'];
  return choices[Math.floor(rng((o.seed * 40503 + 11) >>> 0)() * choices.length)];
}

/** The fill written into a pattern's lanes (only lanes that change are returned). */
export function fillLanes(p: Project, pattern: Pattern, o: FillOptions): Record<string, Lane> {
  const type = resolveFillType(p, o);
  const total = patternSteps(p, pattern);
  const n = Math.max(1, Math.min(total, Math.round(o.steps)));
  const from = total - n;
  const rand = rng((o.seed * 2246822519 + 3) >>> 0);
  const tracks = roleTracks(p);
  const roleById = new Map(p.tracks.map((t) => [t.id, roleOf(t, p)]));
  const snareId = tracks.snare ?? tracks.clap;
  const toms = (['tomhigh', 'tommid', 'tomlow'] as Role[]).map((r) => tracks[r]).filter((id): id is string => !!id);
  const it = clamp(o.intensity, 0, 1);
  // Louder towards the end of the fill.
  const crescendo = (j: number) => round2(clamp(0.45 + (0.5 * j) / Math.max(1, n - 1) + (rand() - 0.5) * 0.06, 0.2, 1));
  // Which of the fill's steps get a hit: 8ths at low intensity, 16ths at high, always the last step.
  const dense = (j: number) => j === n - 1 || j % 2 === 0 || rand() < it * 1.2 - 0.1 || j >= n - Math.ceil(n * it * 0.6);
  const rollAt = (j: number) => (it > 0.45 && j >= n - Math.max(1, Math.round(n * 0.25 * it)) ? (it > 0.8 ? 3 : 2) : 1);

  const out: Record<string, Lane> = {};
  const edit = (trackId: string, fn: (s: Step, j: number, i: number) => Step) => {
    const base = unrollLane(pattern.lanes[trackId], total);
    const steps = base.steps.map((s, i) => (i < from || i >= total || s.locked ? s : fn(s, i - from, i)));
    out[trackId] = { length: total, steps };
  };
  const hit = (s: Step, velocity: number, ratchet = 1): Step => ({ ...s, on: true, velocity, probability: 1, micro: 0, ratchet });
  const off = (s: Step): Step => (s.on ? { ...s, on: false } : s);

  for (const t of p.tracks) {
    const role = roleById.get(t.id);
    if (!hasHits(pattern.lanes[t.id]) && t.id !== snareId && !toms.includes(t.id) && t.id !== tracks.kick) continue;
    if (type === 'break') {
      // Everything stops, then a pickup snare on the last step (and the 8th before it when intense).
      edit(t.id, (s, j) => (t.id === snareId && (j === n - 1 || (it > 0.5 && j === n - 3 && n > 3)) ? hit(s, j === n - 1 ? 0.95 : 0.7) : off(s)));
      continue;
    }
    if (role && TIMEKEEPERS.includes(role)) {
      // Hats thin out to the beat so the fill comes through.
      edit(t.id, (s, j, i) => (i % 4 === 0 && it < 0.7 && s.on ? s : off(s)));
    } else if (t.id === tracks.kick) {
      edit(t.id, (s, j, i) => {
        if (type === 'build') return dense(j) ? hit(s, crescendo(j)) : off(s);
        if (type === 'toms') return i % 4 === 0 ? hit(s, 0.85) : off(s);
        return j === 0 ? hit(s, 0.9) : off(s);
      });
    } else if (t.id === snareId) {
      edit(t.id, (s, j) => {
        if (type === 'roll' || type === 'build') return dense(j) ? hit(s, crescendo(j), type === 'roll' ? rollAt(j) : 1) : off(s);
        // Tom run: the snare starts it off.
        return j === 0 ? hit(s, 0.8) : off(s);
      });
    } else if (toms.includes(t.id)) {
      if (type !== 'toms') continue;
      // High to low across the fill: each tom gets its share of the steps.
      const k = toms.indexOf(t.id);
      edit(t.id, (s, j) => {
        const seg = Math.min(toms.length - 1, Math.floor((Math.max(0, j - 1) * toms.length) / Math.max(1, n - 1)));
        return j > 0 && seg === k && dense(j) ? hit(s, crescendo(j)) : off(s);
      });
    } else if (role === 'clap') {
      edit(t.id, off);
    }
  }
  return out;
}

/** Write a fill into the end of the current pattern. */
export function fillPattern(p: Project, o: FillOptions): Project {
  const pattern = currentPattern(p);
  return setPatternLanes(p, pattern.id, fillLanes(p, pattern, o));
}

/** A new pattern after the current one: a copy with a fill at the end. Becomes the current pattern. */
export function addFillPattern(p: Project, o: FillOptions): Project {
  const src = currentPattern(p);
  const dup = duplicatePattern(p, src.id);
  if (dup === p) return p;
  const id = dup.currentPatternId;
  const withFill = fillPattern(dup, o);
  return { ...withFill, patterns: withFill.patterns.map((pt) => (pt.id === id ? { ...pt, name: `${src.name} fill` } : pt)) };
}

// --- humanise ---

export const FEELS = [
  { id: 'natural', name: 'Natural' },
  { id: 'laidback', name: 'Laid back' },
  { id: 'pushed', name: 'Pushed' },
  { id: 'tight', name: 'Tight' },
] as const;
export type Feel = (typeof FEELS)[number]['id'];

export interface HumaniseOptions {
  /** 0..1: how far hits drift in time. */
  timing: number;
  /** 0..1: how much velocities vary. */
  velocity: number;
  feel: Feel;
  seed: number;
  salt?: number;
}

// Where each kind of sound sits against the grid in each feel, in steps.
const FEEL_OFFSET: Record<Feel, Partial<Record<Role, number>>> = {
  natural: {},
  laidback: { snare: 0.08, clap: 0.08, rim: 0.06, hat: 0.05, openhat: 0.05, shaker: 0.05, ride: 0.04 },
  pushed: { hat: -0.05, openhat: -0.05, shaker: -0.05, ride: -0.04, snare: -0.02, clap: -0.02 },
  tight: {},
};
// How loose each sound is at full timing: drums that anchor the beat move least.
const LOOSENESS: Partial<Record<Role, number>> = { kick: 0.4, snare: 0.6, clap: 0.6, crash: 0.4 };

/**
 * Humanise a lane: each hit gets a small seeded timing offset (on top of the
 * feel's placement) and a velocity nudge. Timing is set, not added, so applying
 * it again with the same settings gives the same timing. "Tight" pulls hits back
 * onto the grid. Locked steps and steps past the lane length are left alone.
 */
export function humaniseLane(lane: Lane, role: Role | null, o: HumaniseOptions): Lane {
  const rand = rng((o.seed * 1597334677 + (o.salt ?? 0) * 7919 + 29) >>> 0);
  const base = (role && FEEL_OFFSET[o.feel][role]) || 0;
  const loose = (role && LOOSENESS[role]) ?? 1;
  const spread = o.feel === 'tight' ? 0.25 : 1;
  const steps = lane.steps.map((s, i) => {
    const t = rand();
    const v = rand();
    if (i >= lane.length || s.locked || !s.on) return s;
    const micro = round2(clamp(base + (t - 0.5) * 2 * 0.12 * o.timing * loose * spread, -0.5, 0.5));
    const velocity = round2(clamp(s.velocity + (v - 0.5) * 2 * 0.18 * o.velocity, 0.1, 1));
    return { ...s, micro, velocity };
  });
  return { ...lane, steps };
}

export function humanise(p: Project, trackIds: string[], o: HumaniseOptions): Project {
  const pattern = currentPattern(p);
  const lanes: Record<string, Lane> = {};
  for (const id of trackIds) {
    const t = p.tracks.find((x) => x.id === id);
    if (!t || !pattern.lanes[id]) continue;
    lanes[id] = humaniseLane(pattern.lanes[id], roleOf(t, p), { ...o, salt: p.tracks.indexOf(t) });
  }
  return setPatternLanes(p, pattern.id, lanes);
}

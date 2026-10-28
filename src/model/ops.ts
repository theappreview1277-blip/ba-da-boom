import { emptyLane, emptyStep, newId } from './defaults';
import { varyLane, type VariationOptions } from './generate';
import { MAX_SONG_BARS, MAX_STEPS, STEPS_PER_BAR, type Lane, type Pattern, type Project, type Step, type TrackSound } from './types';

// Pure project edits. Each returns a new Project and never mutates its input,
// which is what makes undo/redo a simple stack of snapshots.

export const currentPattern = (p: Project): Pattern =>
  p.patterns.find((x) => x.id === p.currentPatternId) ?? p.patterns[0];

function mapPattern(p: Project, patternId: string, fn: (pt: Pattern) => Pattern): Project {
  return { ...p, patterns: p.patterns.map((pt) => (pt.id === patternId ? fn(pt) : pt)) };
}

function mapLane(p: Project, patternId: string, trackId: string, fn: (l: Lane) => Lane): Project {
  return mapPattern(p, patternId, (pt) => ({ ...pt, lanes: { ...pt.lanes, [trackId]: fn(pt.lanes[trackId]) } }));
}

export function setStep(p: Project, patternId: string, trackId: string, index: number, patch: Partial<Step>): Project {
  if (index < 0 || index >= MAX_STEPS) return p;
  return mapLane(p, patternId, trackId, (l) => {
    const steps = l.steps.slice();
    steps[index] = { ...steps[index], ...patch };
    return { ...l, steps };
  });
}

export function toggleStep(p: Project, patternId: string, trackId: string, index: number): Project {
  const on = currentLane(p, patternId, trackId).steps[index]?.on ?? false;
  return setStep(p, patternId, trackId, index, { on: !on });
}

export function currentLane(p: Project, patternId: string, trackId: string): Lane {
  return p.patterns.find((x) => x.id === patternId)?.lanes[trackId] ?? emptyLane();
}

export function setLaneLength(p: Project, patternId: string, trackId: string, length: number): Project {
  const len = Math.max(1, Math.min(MAX_STEPS, Math.round(length)));
  return mapLane(p, patternId, trackId, (l) => ({ ...l, length: len }));
}

export function setPatternLength(p: Project, patternId: string, length: number): Project {
  return p.tracks.reduce((acc, t) => setLaneLength(acc, patternId, t.id, length), p);
}

export function clearLane(p: Project, patternId: string, trackId: string): Project {
  return mapLane(p, patternId, trackId, (l) => ({ ...l, steps: l.steps.map(() => emptyStep()) }));
}

export function clearPattern(p: Project, patternId: string): Project {
  return p.tracks.reduce((acc, t) => clearLane(acc, patternId, t.id), p);
}

export function pasteLane(p: Project, patternId: string, trackId: string, lane: Lane): Project {
  return mapLane(p, patternId, trackId, () => structuredClone(lane));
}

export function pastePattern(p: Project, patternId: string, source: Pattern): Project {
  return mapPattern(p, patternId, (pt) => ({ ...pt, lanes: structuredClone(source.lanes) }));
}

export function duplicatePattern(p: Project, patternId: string): Project {
  const src = p.patterns.find((x) => x.id === patternId);
  if (!src) return p;
  const copy: Pattern = { id: newId('p'), name: `${src.name} copy`, lanes: structuredClone(src.lanes) };
  const idx = p.patterns.indexOf(src);
  const patterns = [...p.patterns.slice(0, idx + 1), copy, ...p.patterns.slice(idx + 1)];
  return { ...p, patterns, currentPatternId: copy.id };
}

export function setTrackSound(p: Project, trackId: string, patch: Partial<TrackSound>): Project {
  return { ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, sound: { ...t.sound, ...patch } } : t)) };
}

export function setTrack(p: Project, trackId: string, patch: Partial<{ name: string; mute: boolean; solo: boolean }>): Project {
  return { ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)) };
}

/** Undo/redo as snapshot stacks. Projects are small, so snapshots are cheap. */
export interface History {
  past: Project[];
  present: Project;
  future: Project[];
  /** Consecutive commits with the same key (e.g. one slider drag) merge into one undo step. */
  mergeKey?: string;
}

const HISTORY_LIMIT = 200;

export const historyOf = (p: Project): History => ({ past: [], present: p, future: [] });

export function commit(h: History, next: Project, mergeKey?: string): History {
  if (next === h.present) return h;
  if (mergeKey && mergeKey === h.mergeKey) return { ...h, present: next, future: [] };
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [], mergeKey };
}

/** Replace the present without an undo entry (used for transient UI state like the current pattern). */
export function replacePresent(h: History, next: Project): History {
  return { ...h, present: next };
}

export function undo(h: History): History {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], mergeKey: undefined };
}

export function redo(h: History): History {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), mergeKey: undefined };
}

export function setLane(p: Project, patternId: string, trackId: string, fn: (l: Lane) => Lane): Project {
  return mapLane(p, patternId, trackId, fn);
}

/** A new pattern after `patternId`: a seeded variation of every lane. Becomes the current pattern. */
export function addVariation(p: Project, patternId: string, opts: Omit<VariationOptions, 'salt'>): Project {
  const dup = duplicatePattern(p, patternId);
  if (dup === p) return p;
  const src = p.patterns.find((x) => x.id === patternId)!;
  const id = dup.currentPatternId;
  const lanes = Object.fromEntries(
    Object.entries(currentPattern(dup).lanes).map(([trackId, lane]) => [trackId, varyLane(lane, { ...opts, salt: p.tracks.findIndex((t) => t.id === trackId) })]),
  );
  return { ...dup, patterns: dup.patterns.map((pt) => (pt.id === id ? { ...pt, name: `${src.name} var ${opts.seed}`, lanes } : pt)) };
}

// --- song arrangement ---

/** Bars needed to hear every lane of a pattern once (its longest lane). */
export function patternBars(p: Project, patternId: string): number {
  const pt = p.patterns.find((x) => x.id === patternId);
  if (!pt) return 1;
  const longest = Math.max(...p.tracks.map((t) => pt.lanes[t.id]?.length ?? STEPS_PER_BAR));
  return Math.max(1, Math.min(MAX_SONG_BARS, Math.ceil(longest / STEPS_PER_BAR)));
}

export function songAdd(p: Project, patternId: string, at = p.song.length): Project {
  const song = p.song.slice();
  song.splice(at, 0, { patternId, bars: patternBars(p, patternId) });
  return { ...p, song };
}

export function songRemove(p: Project, index: number): Project {
  return { ...p, song: p.song.filter((_, i) => i !== index) };
}

export function songMove(p: Project, index: number, to: number): Project {
  if (to < 0 || to >= p.song.length || index === to) return p;
  const song = p.song.slice();
  const [e] = song.splice(index, 1);
  song.splice(to, 0, e);
  return { ...p, song };
}

export function songSetBars(p: Project, index: number, bars: number): Project {
  const b = Math.max(1, Math.min(MAX_SONG_BARS, Math.round(bars)));
  return { ...p, song: p.song.map((e, i) => (i === index ? { ...e, bars: b } : e)) };
}

/** Total length of the song in bars. */
export const songBars = (p: Project) => p.song.reduce((n, e) => n + e.bars, 0);

// --- pattern list ---

/** Move a pattern to position `to` in the list (pattern keys 1–8 follow the order). */
export function movePattern(p: Project, patternId: string, to: number): Project {
  const from = p.patterns.findIndex((x) => x.id === patternId);
  const dest = Math.max(0, Math.min(p.patterns.length - 1, Math.round(to)));
  if (from < 0 || from === dest) return p;
  const patterns = p.patterns.slice();
  const [pt] = patterns.splice(from, 1);
  patterns.splice(dest, 0, pt);
  return { ...p, patterns };
}

/** How much a removal would lose: hits in the pattern and song entries that use it. */
export function patternUsage(p: Project, patternId: string) {
  const pt = p.patterns.find((x) => x.id === patternId);
  const hits = pt ? Object.values(pt.lanes).reduce((n, l) => n + l.steps.filter((s) => s.on).length, 0) : 0;
  return { hits, songEntries: p.song.filter((e) => e.patternId === patternId).length };
}

/**
 * Remove a pattern and its song entries. The last pattern can't be removed.
 * The neighbour (the next one, or the previous at the end) becomes current.
 */
export function removePattern(p: Project, patternId: string): Project {
  const i = p.patterns.findIndex((x) => x.id === patternId);
  if (i < 0 || p.patterns.length <= 1) return p;
  const patterns = p.patterns.filter((x) => x.id !== patternId);
  const currentPatternId = p.currentPatternId === patternId ? patterns[Math.min(i, patterns.length - 1)].id : p.currentPatternId;
  return { ...p, patterns, currentPatternId, song: p.song.filter((e) => e.patternId !== patternId) };
}

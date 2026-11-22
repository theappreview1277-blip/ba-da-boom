// The playhead, meters and "what is playing" display, drawn on animation frames,
// independent of scheduling. Stopped and quiet, the frames go idle to save battery.
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { currentPattern, patternBars } from '../model/ops';
import { STEPS_PER_BAR } from '../model/types';
import type { AppCtx } from './appContext';

interface PlayheadOptions {
  /** The bars on screen and whether pages follow the playhead. */
  pageRef: MutableRefObject<{ start: number; steps: number; total: number; follow: boolean }>;
  setPageIndex: (i: number) => void;
  setPlaying: (on: boolean) => void;
  setAudiblePattern: (fn: (prev: string | null) => string | null) => void;
  setQueuedPattern: (fn: (prev: string | null) => string | null) => void;
  setSongIndex: (fn: (prev: number) => number) => void;
}

export function usePlayhead(ctx: AppCtx, opts: PlayheadOptions) {
  const { engineRef, projectRef, dispatch } = ctx;
  const rows = useRef(new Map<string, HTMLDivElement>());
  const rowRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) rows.current.set(id, el);
    else rows.current.delete(id);
  }, []);
  const trackMeters = useRef<(HTMLDivElement | null)[]>([]);
  const meterRef = useCallback((i: number) => (el: HTMLDivElement | null) => void (trackMeters.current[i] = el), []);
  const mixerMeters = useRef<(HTMLDivElement | null)[]>([]);
  const mixerMeterRef = useCallback((i: number) => (el: HTMLDivElement | null) => void (mixerMeters.current[i] = el), []);
  const masterL = useRef<HTMLDivElement | null>(null);
  const masterR = useRef<HTMLDivElement | null>(null);
  const clipRef = useRef<HTMLButtonElement | null>(null);
  const limitRef = useRef<HTMLSpanElement | null>(null);
  const positionEl = useRef<HTMLDivElement | null>(null);
  const positionRef = useCallback((el: HTMLDivElement | null) => void (positionEl.current = el), []);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let raf = 0;
    let ending = false;
    let wasIdle = false;
    const lastPlay = new Map<string, HTMLElement>();
    const level = (p: number) => Math.max(0, Math.min(1, 1 + (20 * Math.log10(Math.max(p, 1e-6))) / 60));
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const o = optsRef.current;
      const engine = engineRef.current;
      if (!engine || !engine.isPlaying) {
        lastPlay.forEach((el) => el.classList.remove('play'));
        lastPlay.clear();
      }
      if (!engine) return;
      // Stopped and quiet: draw the resting state once, then leave the frames idle (saves battery).
      const idle = engine.idle;
      if (idle && wasIdle) return;
      wasIdle = idle;
      const p = projectRef.current;
      const audible = engine.audiblePatternId;
      o.setAudiblePattern((prev) => (prev === audible ? prev : audible));
      const song = engine.songState();
      const idx = song?.index ?? -1;
      o.setSongIndex((prev) => (prev === idx ? prev : idx));
      if (song?.finished) {
        // End of the song (no loop): stop once the last bar has been heard (once, not on every frame until it has).
        if (!ending) {
          ending = true;
          void engine.stop().then(() => o.setPlaying(false)).finally(() => (ending = false));
        }
      } else if (song && idx >= 0) {
        // In song mode the grid follows the pattern being heard.
        const id = p.song[idx]?.patternId;
        if (id && id !== p.currentPatternId) dispatch({ type: 'transient', fn: (q) => ({ ...q, currentPatternId: id }) });
      }
      const queued = engine.queued?.patternId ?? null;
      o.setQueuedPattern((prev) => (prev === queued ? prev : queued));
      const cycle = engine.patternCycle();
      if (positionEl.current) {
        // Bar and beat of the pattern being heard, for the performance view.
        positionEl.current.textContent =
          cycle == null || !audible
            ? '–'
            : `${p.patterns.find((x) => x.id === audible)?.name ?? ''} · bar ${(Math.floor(cycle) % patternBars(p, audible)) + 1} · beat ${Math.floor((cycle % 1) * 4) + 1}`;
      }
      const shown = audible === p.currentPatternId ? cycle : null;
      const pat = currentPattern(p);
      const pg = o.pageRef.current;
      if (shown != null && pg.follow && engine.isPlaying) {
        // Turn the page when the playhead leaves it.
        const g = Math.floor(shown * STEPS_PER_BAR) % pg.total;
        if (g < pg.start || g >= pg.start + pg.steps) o.setPageIndex(Math.floor(g / pg.steps));
      }
      for (const t of p.tracks) {
        const row = rows.current.get(t.id);
        if (!row) continue;
        let el: HTMLElement | undefined;
        if (shown != null) {
          const len = pat.lanes[t.id]?.length ?? 16;
          const at = (Math.floor(shown * STEPS_PER_BAR) % len) - pg.start;
          el = at >= 0 && at < pg.steps ? (row.children[at] as HTMLElement | undefined) : undefined;
        }
        const prev = lastPlay.get(t.id);
        if (prev !== el) {
          prev?.classList.remove('play');
          el?.classList.add('play');
          if (el) lastPlay.set(t.id, el);
          else lastPlay.delete(t.id);
        }
      }
      const m = engine.readMeters(p.tracks.length);
      m.tracks.forEach((v, i) => {
        const el = trackMeters.current[i];
        if (el) el.style.transform = `scaleY(${level(v)})`;
        const mx = mixerMeters.current[i];
        if (mx) mx.style.transform = `scaleY(${level(v)})`;
      });
      if (masterL.current) masterL.current.style.transform = `scaleX(${level(m.left)})`;
      if (masterR.current) masterR.current.style.transform = `scaleX(${level(m.right)})`;
      clipRef.current?.classList.toggle('on', m.clip);
      limitRef.current?.classList.toggle('on', m.limiting);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { rowRef, meterRef, mixerMeterRef, positionRef, meters: { masterL, masterR, clip: clipRef, limit: limitRef } };
}

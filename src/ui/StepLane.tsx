// The lane under the grid: one bar per step of the selected track, showing and
// editing its loudness (velocity), chance (probability) or timing (microtiming).
// Press and drag across the bars to draw; one drag is one undo step.
import { useRef } from 'react';
import type { StepLane as LaneKind } from '../main/ipc';
import type { Lane, Step } from '../model/types';
import type { GridPage } from './Grid';

const KINDS: { id: LaneKind; label: string; title: string }[] = [
  { id: 'velocity', label: 'Loudness', title: 'How hard each step hits (velocity)' },
  { id: 'probability', label: 'Chance', title: 'Chance that each step plays (probability, seeded)' },
  { id: 'micro', label: 'Timing', title: 'Push each step early (down) or late (up), up to half a step' },
];

let gestures = 0;

/** The value a lane shows for a step, 0..1 (timing: -0.5..0.5). */
export const laneValue = (kind: LaneKind, s: Step) => (kind === 'velocity' ? s.velocity : kind === 'probability' ? s.probability : s.micro);

/** A pointer height (0 = bottom, 1 = top) as the step value, rounded to whole percent. */
export function valueAt(kind: LaneKind, y: number): number {
  const f = Math.max(0, Math.min(1, y));
  const v = kind === 'micro' ? f - 0.5 : f;
  return Math.round(v * 100) / 100;
}

export function StepLane({
  lane,
  page,
  kind,
  color,
  trackName,
  onKind,
  onSet,
}: {
  lane: Lane;
  page: GridPage;
  kind: LaneKind;
  color: string;
  trackName: string;
  onKind: (k: LaneKind) => void;
  onSet: (step: number, patch: Partial<Step>, gesture: string) => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const gesture = useRef<string | null>(null);

  const apply = (clientX: number, clientY: number) => {
    const el = area.current;
    if (!el || !gesture.current) return;
    const r = el.getBoundingClientRect();
    // Same columns as the grid: cells of page.cell pixels with 3 px gaps.
    const i = Math.floor((clientX - r.left) / (page.cell + 3));
    if (i < 0 || i >= page.steps) return;
    const step = page.start + i;
    const s = lane.steps[step];
    if (!s?.on || step >= lane.length) return;
    const v = valueAt(kind, 1 - (clientY - r.top) / r.height);
    if (v === laneValue(kind, s)) return;
    onSet(step, kind === 'velocity' ? { velocity: v } : kind === 'probability' ? { probability: v } : { micro: v }, gesture.current);
  };

  return (
    <div className="step-lane" style={{ ['--cols' as string]: page.steps, ['--cell-w' as string]: `${page.cell}px`, ['--track' as string]: color }}>
      <div className="step-lane-head">
        <div className="step-lane-kinds" role="radiogroup" aria-label="Step lane shows">
          {KINDS.map((k) => (
            <button key={k.id} role="radio" aria-checked={kind === k.id} className={`small ${kind === k.id ? 'on' : ''}`} title={k.title} onClick={() => onKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="step-lane-hint">{trackName}: drag to draw</div>
      </div>
      <div
        className={`step-lane-bars ${kind}`}
        ref={area}
        role="group"
        aria-label={`${KINDS.find((k) => k.id === kind)!.label} of ${trackName}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          gesture.current = `lane:${kind}:${++gestures}`;
          apply(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (gesture.current && e.buttons & 1) apply(e.clientX, e.clientY);
        }}
        onPointerUp={() => (gesture.current = null)}
        onPointerCancel={() => (gesture.current = null)}
      >
        {Array.from({ length: page.steps }, (_, i) => {
          const step = page.start + i;
          const s = lane.steps[step];
          const live = !!s?.on && step < lane.length;
          const v = s ? laneValue(kind, s) : 0;
          const style =
            kind === 'micro'
              ? { bottom: v >= 0 ? '50%' : `${(0.5 + v) * 100}%`, height: `${Math.max(Math.abs(v) * 100, 1)}%` }
              : { bottom: 0, height: `${Math.max(v * 100, 2)}%` };
          return (
            <div key={step} className={`lane-slot ${live ? 'live' : ''}`} data-lane-step={step} title={live ? `Step ${step + 1}: ${kind === 'micro' ? `${v > 0 ? '+' : ''}${Math.round(v * 100)}% step` : `${Math.round(v * 100)}%`}` : undefined}>
              {live && <div className="lane-bar" style={style} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

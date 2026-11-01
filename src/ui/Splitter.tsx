import { useRef } from 'react';

interface Props {
  /** Which panel this handle resizes: the left one grows when dragged right, the right one when dragged left. */
  side: 'left' | 'right';
  label: string;
  width: number;
  min: number;
  max: number;
  /** While dragging. */
  onChange: (w: number) => void;
  /** Drag or key press finished: store it. */
  onCommit: (w: number) => void;
  /** Double-click: back to the default width. */
  onReset: () => void;
}

/** A vertical drag handle between two panels; also works with the arrow keys. */
export function Splitter({ side, label, width, min, max, onChange, onCommit, onReset }: Props) {
  const drag = useRef<{ x: number; w: number; last: number } | null>(null);
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)));
  const dir = side === 'left' ? 1 : -1;
  return (
    <div className="splitter-col">
      <div
        className="splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, w: width, last: width };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          d.last = clamp(d.w + dir * (e.clientX - d.x));
          onChange(d.last);
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (d && d.last !== d.w) onCommit(d.last);
        }}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={onReset}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          e.stopPropagation();
          const step = (e.shiftKey ? 40 : 10) * (e.key === 'ArrowRight' ? 1 : -1) * dir;
          const w = clamp(width + step);
          onChange(w);
          onCommit(w);
        }}
      />
    </div>
  );
}

import { useEffect, useId, useRef, useState } from 'react';

let gesture = 0;

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  /** Called continuously; `mergeKey` is stable for one drag so it becomes one undo step. */
  onChange: (v: number, mergeKey: string) => void;
  disabled?: boolean;
  title?: string;
}

export function Slider({ label, value, min, max, step = 0.01, format, onChange, disabled, title }: SliderProps) {
  const id = useId();
  const key = useRef(`${label}:${gesture}`);
  const fresh = () => (key.current = `${label}:${++gesture}`);
  return (
    <div className="slider" title={title}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onPointerDown={fresh}
        onKeyDown={(e) => {
          // Keep global shortcuts (space, digits) from firing while adjusting a slider.
          e.stopPropagation();
          if (!e.repeat) fresh();
        }}
        onChange={(e) => onChange(Number(e.target.value), key.current)}
        onDoubleClick={(e) => e.currentTarget.blur()}
      />
      <output htmlFor={id}>{format ? format(value) : value.toFixed(2)}</output>
    </div>
  );
}

export function Meter({ refFn, vertical = true, label }: { refFn: (el: HTMLDivElement | null) => void; vertical?: boolean; label: string }) {
  return (
    <div className={`meter ${vertical ? 'v' : 'h'}`} role="meter" aria-label={label}>
      <div className="meter-fill" ref={refFn} />
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Decimal places kept when committing. */
  decimals?: number;
  onCommit: (v: number) => void;
  title?: string;
}

/**
 * A number box you can type into freely: the text is a draft until Enter or
 * leaving the box, then it is clamped to min–max (Escape or junk restores the
 * value). Arrow keys step by 1, Shift+arrow by 10.
 */
export function NumberField({ label, value, min, max, decimals = 0, onCommit, title }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const shown = draft ?? String(value);
  useEffect(() => setDraft(null), [value]);
  const commit = (text: string) => {
    const v = Number(text.replace(',', '.'));
    setDraft(null);
    if (text.trim() === '' || !Number.isFinite(v)) return;
    const f = 10 ** decimals;
    const c = Math.min(max, Math.max(min, Math.round(v * f) / f));
    if (c !== value) onCommit(c);
  };
  return (
    <label className="num" title={title}>
      {label}
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={shown}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          if (!cancelled.current) commit(e.target.value);
          cancelled.current = false;
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            commit(e.currentTarget.value);
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            cancelled.current = true;
            setDraft(null);
            e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const base = Number(shown);
            const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
            commit(String((Number.isFinite(base) ? base : value) + step));
          }
        }}
      />
    </label>
  );
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const db = (v: number) => (v <= 0.0001 ? '-∞ dB' : `${(20 * Math.log10(v)).toFixed(1)} dB`);
export const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);
export const sec = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);

/** Map 0..1 slider position to a log frequency range. */
export const logFreq = {
  toPos: (hzValue: number) => Math.log(hzValue / 20) / Math.log(1000),
  fromPos: (pos: number) => Math.round(20 * Math.pow(1000, pos)),
};

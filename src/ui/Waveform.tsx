import { useEffect, useMemo, useRef } from 'react';

interface Props {
  buffer: AudioBuffer | undefined;
  /** Played region as fractions of the sample, 0..1. */
  start: number;
  end: number;
  label: string;
}

const WIDTH = 300;
const HEIGHT = 56;

/** Peak per pixel column over all channels. */
function peaks(buffer: AudioBuffer, columns: number): Float32Array {
  const out = new Float32Array(columns);
  const per = buffer.length / columns;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let c = 0; c < columns; c++) {
      let m = out[c];
      const to = Math.min(data.length, Math.floor((c + 1) * per));
      for (let i = Math.floor(c * per); i < to; i++) {
        const v = Math.abs(data[i]);
        if (v > m) m = v;
      }
      out[c] = m;
    }
  }
  return out;
}

const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** The selected track's sample, with the part outside start/end dimmed. */
export function Waveform({ buffer, start, end, label }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cols = useMemo(() => (buffer ? peaks(buffer, WIDTH) : null), [buffer]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = WIDTH * dpr;
    el.height = HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = css('--step-off', '#2a2d33');
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    if (!cols) return;
    const a = Math.min(start, end) * WIDTH;
    const b = Math.max(start, end) * WIDTH;
    const mid = HEIGHT / 2;
    for (let x = 0; x < WIDTH; x++) {
      const h = Math.max(1, cols[x] * (HEIGHT - 4));
      ctx.fillStyle = x >= a && x < b ? css('--step-on', '#f0a63a') : css('--muted', '#9aa1ab');
      ctx.globalAlpha = x >= a && x < b ? 1 : 0.35;
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = css('--text', '#e6e8eb');
    ctx.fillRect(Math.round(a), 0, 1, HEIGHT);
    ctx.fillRect(Math.min(WIDTH - 1, Math.round(b)), 0, 1, HEIGHT);
  }, [cols, start, end]);

  const info = buffer
    ? `${buffer.duration < 1 ? `${Math.round(buffer.duration * 1000)} ms` : `${buffer.duration.toFixed(2)} s`} · ${buffer.numberOfChannels === 1 ? 'mono' : 'stereo'} · plays ${Math.round(Math.min(start, end) * 100)}–${Math.round(Math.max(start, end) * 100)}%`
    : 'No sample loaded';
  return (
    <figure className="waveform" aria-label={label}>
      <canvas ref={canvas} style={{ width: WIDTH, height: HEIGHT }} role="img" aria-label={`${label}: ${info}`} />
      <figcaption>{info}</figcaption>
    </figure>
  );
}

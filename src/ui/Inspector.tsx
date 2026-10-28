import type { Step, Track, TrackSound } from '../model/types';
import { RELEASE_FULL } from '../model/types';
import { Slider, db, hz, logFreq, pct, sec } from './controls';

interface Props {
  track: Track;
  trackIndex: number;
  step: Step;
  stepIndex: number;
  laneLength: number;
  sampleName: string;
  onStep: (patch: Partial<Step>, mergeKey?: string) => void;
  onSound: (patch: Partial<TrackSound>, mergeKey?: string) => void;
  onRename: (name: string) => void;
  onAudition: () => void;
}

export function Inspector({ track, trackIndex, step, stepIndex, laneLength, sampleName, onStep, onSound, onRename, onAudition }: Props) {
  const s = track.sound;
  return (
    <div className="inspector">
      <section className="panel-section" aria-label="Step">
        <h3>
          Step {stepIndex + 1}
          <span className="sub">
            {' '}
            · track {trackIndex + 1}
            {stepIndex >= laneLength ? ' · outside lane length' : ''}
          </span>
        </h3>
        <label className="check">
          <input type="checkbox" checked={step.on} onChange={(e) => onStep({ on: e.target.checked })} /> On
        </label>
        <label className="check" title="Locked steps are kept when generating (L)">
          <input type="checkbox" checked={step.locked} onChange={(e) => onStep({ locked: e.target.checked })} /> Locked
        </label>
        <Slider label="Velocity" value={step.velocity} min={0} max={1} format={pct} onChange={(v, k) => onStep({ velocity: v }, k)} />
        <Slider
          label="Probability"
          value={step.probability}
          min={0}
          max={1}
          format={pct}
          title="Chance that this step plays on each pass. Seeded by the project seed, so it is reproducible."
          onChange={(v, k) => onStep({ probability: v }, k)}
        />
        <Slider
          label="Microtiming"
          value={step.micro}
          min={-0.5}
          max={0.5}
          step={0.01}
          format={(v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}% step`}
          title="Push the hit early or late by up to half a step"
          onChange={(v, k) => onStep({ micro: v }, k)}
        />
        <Slider label="Ratchet" value={step.ratchet} min={1} max={8} step={1} format={(v) => `${v}×`} onChange={(v, k) => onStep({ ratchet: v }, k)} />
      </section>

      <section className="panel-section" aria-label="Track sound">
        <h3>
          <input className="track-rename" value={track.name} aria-label="Track name" onKeyDown={(e) => e.stopPropagation()} onChange={(e) => onRename(e.target.value)} />
          <button className="small" onClick={onAudition} title="Play the sample with these settings">
            ▶ Audition
          </button>
        </h3>
        <div className="sample-line" title="Drag a sample from the browser or drop a WAV file on the track to change it">
          Sample: <strong>{sampleName}</strong>
        </div>
        <div className="sound-grid">
          <Slider label="Volume" value={s.volume} min={0} max={1.5} format={db} onChange={(v, k) => onSound({ volume: v }, k)} />
          <Slider label="Pan" value={s.pan} min={-1} max={1} format={(v) => (Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)} onChange={(v, k) => onSound({ pan: v }, k)} />
          <Slider label="Pitch" value={s.pitch} min={-24} max={24} step={1} format={(v) => `${v > 0 ? '+' : ''}${v} st`} onChange={(v, k) => onSound({ pitch: v }, k)} />
          <Slider label="Start" value={s.start} min={0} max={0.99} format={pct} onChange={(v, k) => onSound({ start: v }, k)} />
          <Slider label="End" value={s.end} min={0.01} max={1} format={pct} onChange={(v, k) => onSound({ end: v }, k)} />
          <Slider label="Attack" value={s.attack} min={0} max={0.5} step={0.001} format={sec} onChange={(v, k) => onSound({ attack: v }, k)} />
          <Slider
            label="Release"
            value={s.release}
            min={0}
            max={RELEASE_FULL}
            step={0.01}
            format={(v) => (v >= RELEASE_FULL ? 'Full sample' : sec(v))}
            title="Fade out after the step ends. At maximum the whole sample plays."
            onChange={(v, k) => onSound({ release: v }, k)}
          />
          <div className="slider">
            <label>Choke</label>
            <select
              value={s.choke ?? ''}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => onSound({ choke: e.target.value ? Number(e.target.value) : null })}
              title="Tracks in the same choke group cut each other off"
            >
              <option value="">None</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  Group {n}
                </option>
              ))}
            </select>
            <output />
          </div>
          <Slider label="Low-pass" value={logFreq.toPos(s.lowpass)} min={0} max={1} step={0.001} format={(p) => (p >= 1 ? 'Off' : hz(logFreq.fromPos(p)))} onChange={(p, k) => onSound({ lowpass: logFreq.fromPos(p) }, k)} />
          <Slider label="High-pass" value={logFreq.toPos(s.highpass)} min={0} max={1} step={0.001} format={(p) => (p <= 0 ? 'Off' : hz(logFreq.fromPos(p)))} onChange={(p, k) => onSound({ highpass: logFreq.fromPos(p) }, k)} />
          <Slider label="Drive" value={s.drive} min={0} max={10} step={0.1} format={(v) => (v === 0 ? 'Off' : v.toFixed(1))} onChange={(v, k) => onSound({ drive: v }, k)} />
          <Slider label="Delay send" value={s.delaySend} min={0} max={1} format={pct} onChange={(v, k) => onSound({ delaySend: v }, k)} />
          <Slider label="Reverb send" value={s.reverbSend} min={0} max={1} format={pct} onChange={(v, k) => onSound({ reverbSend: v }, k)} />
        </div>
      </section>
    </div>
  );
}

import type { Step, Track, TrackSound } from '../model/types';
import { FILTER_TYPES, RELEASE_FULL, SYNTH_WAVES, VOWELS } from '../model/types';
import { Slider, db, hz, logFreq, pct, sec } from './controls';
import { Waveform } from './Waveform';

interface Props {
  track: Track;
  trackIndex: number;
  step: Step;
  stepIndex: number;
  laneLength: number;
  sampleName: string;
  sampleBuffer: AudioBuffer | undefined;
  onStep: (patch: Partial<Step>, mergeKey?: string) => void;
  onSound: (patch: Partial<TrackSound>, mergeKey?: string) => void;
  onRename: (name: string) => void;
  onAudition: () => void;
}

export function Inspector({ track, trackIndex, step, stepIndex, laneLength, sampleName, sampleBuffer, onStep, onSound, onRename, onAudition }: Props) {
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
          <button className="small" onClick={onAudition} title="Play this track's sound with these settings (A)">
            ▶ Audition
          </button>
        </h3>
        <div className="source-pick" role="radiogroup" aria-label="Sound source">
          {(['sample', 'synth'] as const).map((src) => (
            <label key={src} className="check">
              <input type="radio" name="sound-source" checked={s.source === src} onChange={() => onSound({ source: src })} /> {src === 'sample' ? 'Sample' : 'Synth'}
            </label>
          ))}
        </div>
        {s.source === 'sample' ? (
          <>
            <div className="sample-line" title="Drag a sample from the browser or drop a sound file (WAV, MP3, FLAC, OGG) on the track to change it">
              Sample: <strong>{sampleName}</strong>
            </div>
            <Waveform buffer={sampleBuffer} start={s.start} end={s.end} label={`Waveform of ${sampleName}`} />
            <label className="check" title="Play the sample backwards">
              <input type="checkbox" checked={s.reverse} onChange={(e) => onSound({ reverse: e.target.checked })} /> Reverse
            </label>
          </>
        ) : (
          <div className="sound-grid">
            <Choice label="Wave" value={s.wave} options={SYNTH_WAVES.map((w) => [w, WAVE_NAMES[w]])} onChange={(wave) => onSound({ wave })} title="Strudel's built-in oscillators, noises and synth kick" />
            <Slider label="Note" value={s.note} min={24} max={96} step={1} format={noteName} onChange={(v, k) => onSound({ note: v }, k)} title="The synth's note; Pitch is added to it" />
          </div>
        )}
        <div className="sound-grid">
          <Slider label="Volume" value={s.volume} min={0} max={1.5} format={db} onChange={(v, k) => onSound({ volume: v }, k)} />
          <Slider label="Pan" value={s.pan} min={-1} max={1} format={(v) => (Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)} onChange={(v, k) => onSound({ pan: v }, k)} />
          <Slider label="Pitch" value={s.pitch} min={-24} max={24} step={1} format={(v) => `${v > 0 ? '+' : ''}${v} st`} onChange={(v, k) => onSound({ pitch: v }, k)} />
          {s.source === 'sample' && (
            <>
              <Slider label="Start" value={s.start} min={0} max={0.99} format={pct} onChange={(v, k) => onSound({ start: v }, k)} />
              <Slider label="End" value={s.end} min={0.01} max={1} format={pct} onChange={(v, k) => onSound({ end: v }, k)} />
            </>
          )}
        </div>

        <h4 className="sub-head">Envelope</h4>
        <div className="sound-grid">
          <Slider label="Attack" value={s.attack} min={0} max={0.5} step={0.001} format={sec} onChange={(v, k) => onSound({ attack: v }, k)} />
          <Slider label="Decay" value={s.decay} min={0} max={2} step={0.01} format={(v) => (v === 0 ? 'Off' : sec(v))} title="Fall from full level to the sustain level" onChange={(v, k) => onSound({ decay: v }, k)} />
          <Slider label="Sustain" value={s.sustain} min={0} max={1} format={pct} title="Level after the decay (used when Decay is on)" onChange={(v, k) => onSound({ sustain: v }, k)} />
          <Slider
            label="Release"
            value={s.release}
            min={0}
            max={RELEASE_FULL}
            step={0.01}
            format={(v) => (v >= RELEASE_FULL ? (s.source === 'synth' ? 'Short' : 'Full sample') : sec(v))}
            title="Fade out after the step ends. At maximum a sample plays to its end."
            onChange={(v, k) => onSound({ release: v }, k)}
          />
          <Choice
            label="Choke"
            value={s.choke == null ? '' : String(s.choke)}
            options={[['', 'None'], ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [String(n), `Group ${n}`] as [string, string])]}
            onChange={(v) => onSound({ choke: v ? Number(v) : null })}
            title="Tracks in the same choke group cut each other off"
          />
        </div>

        <h4 className="sub-head">Filter</h4>
        <div className="sound-grid">
          <Choice label="Type" value={s.filterType} options={FILTER_TYPES.map((f) => [f, FILTER_NAMES[f]])} onChange={(filterType) => onSound({ filterType })} title="12 dB, 24 dB (steeper) or ladder (warmer) filters" />
          <Slider label="Low-pass" value={logFreq.toPos(s.lowpass)} min={0} max={1} step={0.001} format={(p) => (p >= 1 ? 'Off' : hz(logFreq.fromPos(p)))} onChange={(p, k) => onSound({ lowpass: logFreq.fromPos(p) }, k)} />
          <Slider label="Resonance" value={s.resonance} min={0} max={30} step={0.1} format={(v) => (v === 0 ? 'Default' : v.toFixed(1))} onChange={(v, k) => onSound({ resonance: v }, k)} />
          <Slider label="Filter env" value={s.filterEnv} min={-8} max={8} step={0.1} format={(v) => (v === 0 ? 'Off' : `${v > 0 ? '+' : ''}${v.toFixed(1)} oct`)} title="Sweeps the low-pass on every hit, up (+) or down (−), in octaves" onChange={(v, k) => onSound({ filterEnv: v }, k)} />
          <Slider label="Env decay" value={s.filterDecay} min={0.01} max={2} step={0.01} format={sec} title="How long the filter sweep takes" onChange={(v, k) => onSound({ filterDecay: v }, k)} />
          <Slider label="High-pass" value={logFreq.toPos(s.highpass)} min={0} max={1} step={0.001} format={(p) => (p <= 0 ? 'Off' : hz(logFreq.fromPos(p)))} onChange={(p, k) => onSound({ highpass: logFreq.fromPos(p) }, k)} />
          <Slider label="HP resonance" value={s.hpResonance} min={0} max={30} step={0.1} format={(v) => (v === 0 ? 'Default' : v.toFixed(1))} onChange={(v, k) => onSound({ hpResonance: v }, k)} />
          <Slider label="Band-pass" value={s.bandpass ? logFreq.toPos(s.bandpass) : 0} min={0} max={1} step={0.001} format={(p) => (p <= 0 ? 'Off' : hz(logFreq.fromPos(p)))} onChange={(p, k) => onSound({ bandpass: p <= 0 ? 0 : logFreq.fromPos(p) }, k)} />
          <Slider label="Band Q" value={s.bandQ} min={0.1} max={30} step={0.1} format={(v) => v.toFixed(1)} onChange={(v, k) => onSound({ bandQ: v }, k)} />
          <Choice label="Vowel" value={s.vowel} options={VOWELS.map((v) => [v, v ? v.toUpperCase() : 'Off'])} onChange={(vowel) => onSound({ vowel })} title="Formant filter that makes the sound speak a vowel" />
        </div>

        <h4 className="sub-head">Character</h4>
        <div className="sound-grid">
          <Slider label="Drive" value={s.drive} min={0} max={10} step={0.1} format={(v) => (v === 0 ? 'Off' : v.toFixed(1))} onChange={(v, k) => onSound({ drive: v }, k)} />
          <Slider label="Shape" value={s.shape} min={0} max={0.95} step={0.01} format={(v) => (v === 0 ? 'Off' : pct(v))} title="Waveshaping distortion" onChange={(v, k) => onSound({ shape: v }, k)} />
          <Slider label="Bit crush" value={s.crush === 0 ? 17 : s.crush} min={1} max={17} step={1} format={(v) => (v >= 17 ? 'Off' : `${v} bit`)} title="Fewer bits = rougher" onChange={(v, k) => onSound({ crush: v >= 17 ? 0 : v }, k)} />
          <Slider label="Downsample" value={s.coarse} min={1} max={32} step={1} format={(v) => (v <= 1 ? 'Off' : `÷${v}`)} title="Lowers the sample rate for a lo-fi sound" onChange={(v, k) => onSound({ coarse: v }, k)} />
        </div>

        <h4 className="sub-head">Movement</h4>
        <div className="sound-grid">
          <Slider label="Tremolo" value={s.tremoloRate} min={0} max={20} step={0.1} format={(v) => (v === 0 ? 'Off' : `${v.toFixed(1)} Hz`)} onChange={(v, k) => onSound({ tremoloRate: v }, k)} />
          <Slider label="Trem depth" value={s.tremoloDepth} min={0} max={1} format={pct} onChange={(v, k) => onSound({ tremoloDepth: v }, k)} />
          <Slider label="Phaser" value={s.phaserRate} min={0} max={10} step={0.1} format={(v) => (v === 0 ? 'Off' : `${v.toFixed(1)} Hz`)} onChange={(v, k) => onSound({ phaserRate: v }, k)} />
          <Slider label="Phaser depth" value={s.phaserDepth} min={0} max={1} format={pct} onChange={(v, k) => onSound({ phaserDepth: v }, k)} />
        </div>

        <h4 className="sub-head">Sends</h4>
        <div className="sound-grid">
          <Slider label="Delay send" value={s.delaySend} min={0} max={1} format={pct} onChange={(v, k) => onSound({ delaySend: v }, k)} />
          <Slider label="Reverb send" value={s.reverbSend} min={0} max={1} format={pct} onChange={(v, k) => onSound({ reverbSend: v }, k)} />
        </div>
      </section>
    </div>
  );
}

const WAVE_NAMES: Record<(typeof SYNTH_WAVES)[number], string> = {
  sine: 'Sine',
  triangle: 'Triangle',
  square: 'Square',
  sawtooth: 'Saw',
  supersaw: 'Supersaw',
  pulse: 'Pulse',
  white: 'White noise',
  pink: 'Pink noise',
  brown: 'Brown noise',
  crackle: 'Crackle',
  sbd: 'Synth kick',
};
const FILTER_NAMES: Record<(typeof FILTER_TYPES)[number], string> = { '12db': '12 dB', '24db': '24 dB', ladder: 'Ladder' };
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (midi: number) => `${NOTES[midi % 12]}${Math.floor(midi / 12) - 1}`;

/** A labelled select laid out like a slider row. */
function Choice<T extends string>({ label, value, options, onChange, title }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; title?: string }) {
  return (
    <div className="slider" title={title}>
      <label>{label}</label>
      <select value={value} aria-label={label} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, name]) => (
          <option key={v} value={v}>
            {name}
          </option>
        ))}
      </select>
      <output />
    </div>
  );
}

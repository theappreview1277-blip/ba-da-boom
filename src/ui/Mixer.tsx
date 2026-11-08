// The mixer: every track side by side, with its level, pan, effect sends,
// mute and solo, and a meter; the master level at the end.
import { memo, useRef } from 'react';
import type { Track, TrackSound } from '../model/types';
import { trackColor } from './colors';
import { db, Knob, pct } from './controls';

interface Props {
  tracks: Track[];
  masterVolume: number;
  selectedTrack: string;
  meterRef: (index: number) => (el: HTMLDivElement | null) => void;
  masterMeterRef: (el: HTMLDivElement | null) => void;
  onSound: (trackId: string, patch: Partial<TrackSound>, mergeKey?: string) => void;
  onTrack: (trackId: string, patch: { mute?: boolean; solo?: boolean }) => void;
  onSelect: (trackId: string) => void;
  onMaster: (v: number, mergeKey: string) => void;
}

const panText = (v: number) => (Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`);
let gestures = 0;

/** A vertical fader: a range input turned upright. */
function Fader({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number, key: string) => void }) {
  const key = useRef(`fader:${label}:${gestures}`);
  const fresh = () => (key.current = `fader:${label}:${++gestures}`);
  return (
    <input
      className="fader"
      type="range"
      min={0}
      max={max}
      step={0.01}
      value={value}
      aria-label={label}
      aria-valuetext={db(value)}
      onPointerDown={fresh}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (!e.repeat) fresh();
      }}
      onChange={(e) => onChange(Number(e.target.value), key.current)}
    />
  );
}

export const Mixer = memo(function Mixer({ tracks, masterVolume, selectedTrack, meterRef, masterMeterRef, onSound, onTrack, onSelect, onMaster }: Props) {
  const anySolo = tracks.some((t) => t.solo);
  return (
    <div className="mixer" role="group" aria-label="Mixer">
      {tracks.map((t, i) => {
        const s = t.sound;
        const silent = t.mute || (anySolo && !t.solo);
        return (
          <div
            key={t.id}
            className={`strip ${t.id === selectedTrack ? 'selected' : ''} ${silent ? 'silent' : ''}`}
            style={{ ['--track' as string]: trackColor(i) }}
            data-strip={i}
            aria-label={`Track ${i + 1}: ${t.name}`}
            onPointerDown={() => t.id !== selectedTrack && onSelect(t.id)}
          >
            <div className="strip-name" title={t.name}>
              <span className="strip-num">{i + 1}</span> {t.name}
            </div>
            <Knob label="Pan" value={s.pan} min={-1} max={1} format={panText} reset={0} onChange={(v, k) => onSound(t.id, { pan: v }, `mix:${k}`)} />
            <div className="strip-sends">
              <Knob label="Rev" title="Reverb send" value={s.reverbSend} min={0} max={1} format={pct} reset={0} onChange={(v, k) => onSound(t.id, { reverbSend: v }, `mix:${k}`)} />
              <Knob label="Dly" title="Delay send" value={s.delaySend} min={0} max={1} format={pct} reset={0} onChange={(v, k) => onSound(t.id, { delaySend: v }, `mix:${k}`)} />
            </div>
            <div className="strip-fader">
              <Fader label={`${t.name} level`} value={s.volume} max={1.5} onChange={(v, k) => onSound(t.id, { volume: v }, k)} />
              <div className="meter v strip-meter">
                <div className="meter-fill" ref={meterRef(i)} />
              </div>
            </div>
            <output className="strip-db">{db(s.volume)}</output>
            <div className="strip-ms">
              <button className={`small ${t.mute ? 'on mute' : ''}`} aria-pressed={t.mute} title="Mute" onClick={() => onTrack(t.id, { mute: !t.mute })}>
                M
              </button>
              <button className={`small ${t.solo ? 'on solo' : ''}`} aria-pressed={t.solo} title="Solo" onClick={() => onTrack(t.id, { solo: !t.solo })}>
                S
              </button>
            </div>
          </div>
        );
      })}
      <div className="strip master-strip" aria-label="Master">
        <div className="strip-name">Master</div>
        <div className="strip-fader">
          <Fader label="Master level" value={masterVolume} max={1.5} onChange={onMaster} />
          <div className="meter v strip-meter">
            <div className="meter-fill" ref={masterMeterRef} />
          </div>
        </div>
        <output className="strip-db">{db(masterVolume)}</output>
      </div>
    </div>
  );
});

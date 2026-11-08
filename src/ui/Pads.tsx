// Drum pads: one per track, played with the mouse, the keyboard or a MIDI
// controller. With Record on, hits are written into the pattern as it plays.
import { memo } from 'react';
import type { MidiMap } from '../main/ipc';
import { noteName, PAD_KEYS, trackNote } from '../model/live';
import type { Track } from '../model/types';
import type { MidiState } from './devices';
import { trackColor } from './colors';

interface Props {
  tracks: Track[];
  recording: boolean;
  quantise: boolean;
  padKeys: boolean;
  midiMap: MidiMap;
  midi: MidiState;
  padRef: (index: number) => (el: HTMLButtonElement | null) => void;
  onHit: (index: number, velocity: number) => void;
  onRecord: () => void;
  onQuantise: (on: boolean) => void;
  onPadKeys: (on: boolean) => void;
  onSettings: () => void;
}

const keyLabel = (k: string) => (k === ',' ? ',' : k.toUpperCase());

export const Pads = memo(function Pads({ tracks, recording, quantise, padKeys, midiMap, midi, padRef, onHit, onRecord, onQuantise, onPadKeys, onSettings }: Props) {
  const midiText =
    midi.status === 'unavailable'
      ? 'MIDI is not available on this computer'
      : midi.inputs.length
        ? `MIDI: ${midi.inputs.join(', ')}`
        : 'No MIDI controller connected';
  return (
    <div className="pads">
      <div className="pads-head">
        <button className={`rec ${recording ? 'on' : ''}`} aria-pressed={recording} onClick={onRecord} title="Record what you play into the pattern while it plays (R)">
          <span className="rec-dot" aria-hidden="true" /> {recording ? 'Recording' : 'Record'}
        </button>
        <label className="check" title="Put recorded hits exactly on the nearest step. Off keeps how early or late you played (timing).">
          <input type="checkbox" checked={quantise} onChange={(e) => onQuantise(e.target.checked)} /> Snap to steps
        </label>
        <label className="check" title="The letter keys Z X C V B N M , and A S D F G H J K play the pads. Other letter shortcuts are off while this is on.">
          <input type="checkbox" checked={padKeys} onChange={(e) => onPadKeys(e.target.checked)} /> Keys play pads
        </label>
        <button className="small link midi-status" onClick={onSettings} title="Choose the MIDI input and how notes map to pads">
          {midiText}
        </button>
      </div>
      <div className="pad-grid" role="group" aria-label="Drum pads">
        {tracks.map((t, i) => {
          const note = trackNote(i, midiMap);
          return (
            <button
              key={t.id}
              ref={padRef(i)}
              className="drum-pad"
              style={{ ['--track' as string]: trackColor(i) }}
              data-pad={i}
              title={`Play ${t.name}${padKeys && PAD_KEYS[i] ? ` (key ${keyLabel(PAD_KEYS[i])})` : ''}${note != null ? `, MIDI note ${note}` : ''}. Hit near the top to play louder.`}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                const r = e.currentTarget.getBoundingClientRect();
                // Louder towards the top of the pad: 40 % at the bottom to 100 % at the top.
                const v = Math.round((0.4 + 0.6 * (1 - (e.clientY - r.top) / r.height)) * 100) / 100;
                onHit(i, Math.max(0.4, Math.min(1, v)));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.repeat) {
                  e.preventDefault();
                  onHit(i, 0.8);
                }
              }}
            >
              <span className="pad-track">{t.name}</span>
              <span className="pad-meta">
                {padKeys && PAD_KEYS[i] && <kbd>{keyLabel(PAD_KEYS[i])}</kbd>}
                {note != null && <span className="pad-note">{noteName(note)}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
});

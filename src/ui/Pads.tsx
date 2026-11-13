// Drum pads: one per track, played with the mouse, the keyboard or a MIDI
// controller. With Record on, hits are written into the pattern as it plays.
import { memo } from 'react';
import { noteName } from '../model/live';
import type { Track } from '../model/types';
import type { MidiState } from './devices';
import { trackColor } from './colors';

interface Props {
  tracks: Track[];
  recording: boolean;
  quantise: boolean;
  padKeys: boolean;
  /** The key and MIDI note of each pad (null: none). */
  keys: (string | null)[];
  notes: (number | null)[];
  midi: MidiState;
  /** Choosing keys and notes: the pad waiting for one, or null when not choosing. */
  assigning: number | null;
  onAssign: (pad: number | null) => void;
  onClearPad: (pad: number) => void;
  onResetAll: () => void;
  padRef: (index: number) => (el: HTMLButtonElement | null) => void;
  onHit: (index: number, velocity: number) => void;
  onRecord: () => void;
  onQuantise: (on: boolean) => void;
  onPadKeys: (on: boolean) => void;
  onSettings: () => void;
}

const keyLabel = (k: string) => (k === ',' ? ',' : k.toUpperCase());

export const Pads = memo(function Pads({ tracks, recording, quantise, padKeys, keys, notes, midi, assigning, onAssign, onClearPad, onResetAll, padRef, onHit, onRecord, onQuantise, onPadKeys, onSettings }: Props) {
  const choosing = assigning !== null;
  const custom = tracks.some((t) => t.key !== undefined || t.note !== undefined);
  const midiText =
    midi.status === 'unavailable'
      ? 'MIDI is not available on this computer'
      : !midi.inputs.length
        ? 'No MIDI controller connected'
        : midi.listening.length
          ? `MIDI: ${midi.listening.join(', ')}`
          : 'MIDI off';
  return (
    <div className="pads">
      <div className="pads-head">
        <button className={`rec ${recording ? 'on' : ''}`} aria-pressed={recording} onClick={onRecord} title="Record what you play into the pattern while it plays (R)">
          <span className="rec-dot" aria-hidden="true" /> {recording ? 'Recording' : 'Record'}
        </button>
        <label className="check" title="Put recorded hits exactly on the nearest step. Off keeps how early or late you played (timing).">
          <input type="checkbox" checked={quantise} onChange={(e) => onQuantise(e.target.checked)} /> Snap to steps
        </label>
        <label className="check" title="Keys play the pads: Z X C V B N M , and A S D F G H J K, or the ones you choose with Set keys and notes. Shortcuts on those keys are off while this is on.">
          <input type="checkbox" checked={padKeys} onChange={(e) => onPadKeys(e.target.checked)} /> Keys play pads
        </label>
        <button
          className={`small assign-btn ${choosing ? 'on' : ''}`}
          aria-pressed={choosing}
          onClick={() => onAssign(choosing ? null : 0)}
          title="Choose which key and which MIDI controller pad plays each pad"
        >
          {choosing ? 'Done' : 'Set keys and notes'}
        </button>
        <button className="small link midi-status" onClick={onSettings} title="Choose the MIDI input and how notes map to pads">
          {midiText}
        </button>
      </div>
      {choosing && (
        <div className="assign-bar" role="status">
          <span>
            {assigning! < tracks.length ? (
              <>
                <strong>{tracks[assigning!].name}</strong>: press a key, or hit a pad on your MIDI controller. Click another pad to change that one instead.
              </>
            ) : (
              'Click a pad to change its key or note.'
            )}
          </span>
          {assigning! < tracks.length && (
            <button className="small" onClick={() => onClearPad(assigning!)} title="This pad gets no key and no MIDI note (Backspace)">
              No key or note
            </button>
          )}
          <button className="small" disabled={!custom} onClick={onResetAll} title="Forget the keys and notes chosen here and use the usual layout again">
            Back to the usual layout
          </button>
        </div>
      )}
      <div className={`pad-grid ${choosing ? 'choosing' : ''}`} role="group" aria-label="Drum pads">
        {tracks.map((t, i) => {
          const note = notes[i];
          const key = keys[i];
          const showKey = (padKeys || choosing) && key;
          return (
            <button
              key={t.id}
              ref={padRef(i)}
              className={`drum-pad ${assigning === i ? 'target' : ''}`}
              style={{ ['--track' as string]: trackColor(i) }}
              data-pad={i}
              title={
                choosing
                  ? `Change the key or MIDI note for ${t.name}`
                  : `Play ${t.name}${padKeys && key ? ` (key ${keyLabel(key)})` : ''}${note != null ? `, MIDI note ${note}` : ''}. Hit near the top to play louder.`
              }
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                if (choosing) {
                  onAssign(i);
                  return;
                }
                const r = e.currentTarget.getBoundingClientRect();
                // Louder towards the top of the pad: 40 % at the bottom to 100 % at the top.
                const v = Math.round((0.4 + 0.6 * (1 - (e.clientY - r.top) / r.height)) * 100) / 100;
                onHit(i, Math.max(0.4, Math.min(1, v)));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.repeat && !choosing) {
                  e.preventDefault();
                  onHit(i, 0.8);
                }
              }}
            >
              <span className="pad-track">{t.name}</span>
              <span className="pad-meta">
                {showKey && <kbd>{keyLabel(key)}</kbd>}
                {choosing && !key && <span className="pad-none">no key</span>}
                {note != null && <span className="pad-note">{noteName(note)}</span>}
                {choosing && note == null && <span className="pad-none">no note</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
});

// The Settings window: which sound card plays, and how MIDI controllers and the
// keyboard play the pads.
import type { MidiMap, SoundSettings as Sound } from '../main/ipc';
import { noteName } from '../model/live';
import type { MidiState, OutputDevice } from './devices';

interface Props {
  sound: Sound;
  outputs: OutputDevice[];
  /** The sound card in use now, or null for the system default. */
  activeOutput: OutputDevice | null;
  midi: MidiState;
  lastNote: { note: number; input: string; track: string | null } | null;
  onChange: (patch: Partial<Sound>) => void;
  onOutput: (device: OutputDevice | null) => void;
  onTest: () => void;
}

/** The MIDI input menu's value for "off"; no device is called this. */
const OFF = '\u0000off';

export function SoundSettings({ sound, outputs, activeOutput, midi, lastNote, onChange, onOutput, onTest }: Props) {
  const savedMissing = sound.output && !activeOutput;
  return (
    <div className="settings">
      <section>
        <h3>Sound output</h3>
        <div className="settings-row">
          <select
            aria-label="Sound output"
            value={activeOutput?.id ?? ''}
            onChange={(e) => onOutput(outputs.find((d) => d.id === e.target.value) ?? null)}
          >
            <option value="">System default</option>
            {outputs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          <button className="small" onClick={onTest} title="Play the selected track's sound">
            Test sound
          </button>
        </div>
        {savedMissing && (
          <p className="warn">
            {sound.output!.label} is not connected, so the system default is playing. It is used again when you plug it back in.{' '}
            <button className="small link forget-output" onClick={() => onOutput(null)} title="Stop waiting for this sound card and keep using the system default">
              Forget it
            </button>
          </p>
        )}
        <p className="hint">Exported WAV files are not affected.</p>
      </section>

      <section>
        <h3>MIDI controller</h3>
        {midi.status === 'unavailable' ? (
          <p className="hint">MIDI is not available on this computer.</p>
        ) : (
          <>
            <div className="settings-row">
              <label>
                Input{' '}
                <select
                  aria-label="MIDI input"
                  value={sound.midiOff ? OFF : sound.midiInput ?? ''}
                  onChange={(e) => onChange(e.target.value === OFF ? { midiOff: true } : { midiOff: false, midiInput: e.target.value })}
                >
                  <option value={OFF}>Off (no MIDI controller)</option>
                  <option value="">Every connected input</option>
                  {[...new Set([...midi.inputs, ...(sound.midiInput ? [sound.midiInput] : [])])].map((n) => (
                    <option key={n} value={n}>
                      {n}
                      {midi.inputs.includes(n) ? '' : ' (not connected)'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Notes{' '}
                <select aria-label="MIDI notes" value={sound.midiMap ?? 'gm'} onChange={(e) => onChange({ midiMap: e.target.value as MidiMap })}>
                  <option value="gm">Drum kit (General MIDI: 36 kick, 38 snare, 42 hat …)</option>
                  <option value="pads36">Pads in order from C1 (36, 37, 38 …)</option>
                </select>
              </label>
            </div>
            <p className="hint midi-last" aria-live="polite">
              {sound.midiOff
                ? 'MIDI is off. Ba-da-boom has let go of your controllers, so other programs can use them.'
                : !midi.inputs.length
                ? 'No MIDI controller connected. Plug one in and it is found straight away.'
                : lastNote
                  ? `Last note: ${noteName(lastNote.note)} (${lastNote.note}) from ${lastNote.input}${lastNote.track ? ` played ${lastNote.track}` : ', which no pad uses'}`
                  : 'Hit a pad or key on your controller to check it.'}
            </p>
          </>
        )}
      </section>

      <p className="hint">Snapping recorded hits and playing pads from the keyboard are set on the Pads tab.</p>
    </div>
  );
}

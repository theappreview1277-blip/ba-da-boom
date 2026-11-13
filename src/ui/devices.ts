// The computer's sound cards and MIDI inputs.
import { parseNoteOn } from '../model/live';

export interface OutputDevice {
  id: string;
  label: string;
}

/** Sound cards the app can play through, apart from the system default (which is always offered). */
export async function listOutputs(): Promise<OutputDevice[]> {
  let devs: MediaDeviceInfo[] = [];
  try {
    devs = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
  } catch {
    return [];
  }
  return devs
    .filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Sound card ${i + 1}` }));
}

/** The saved sound card among those connected now: by its id, or by its name if the id changed. */
export function findOutput(list: OutputDevice[], saved: { id: string; label: string } | undefined): OutputDevice | null {
  if (!saved?.id) return null;
  return list.find((d) => d.id === saved.id) ?? list.find((d) => d.label === saved.label) ?? null;
}

/** Every connected input, and the ones the app has open and listens to. */
export type MidiState = { status: 'off' | 'asking' | 'ready' | 'unavailable'; inputs: string[]; listening: string[] };

/**
 * Listens to MIDI inputs and reports note-ons. One instance for the app.
 * Only the inputs in use are opened; the rest are closed, so other programs can
 * use them (on Windows a MIDI port can be open in one program at a time).
 */
export class Midi {
  private access: MIDIAccess | null = null;
  /** Only this input (by name), or every input when null. */
  private only: string | null = null;
  /** MIDI turned off in Settings: every input is closed. */
  private off = false;
  /** Nothing is opened until the saved choice has been given with use(). */
  private chosen = false;
  state: MidiState = { status: 'off', inputs: [], listening: [] };
  onNote?: (note: number, velocity: number, input: string) => void;
  onState?: (s: MidiState) => void;

  async start() {
    if (this.access || this.state.status === 'asking') return;
    if (!navigator.requestMIDIAccess) return this.set({ status: 'unavailable', inputs: [], listening: [] });
    this.set({ status: 'asking', inputs: [], listening: [] });
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      return this.set({ status: 'unavailable', inputs: [], listening: [] });
    }
    this.access.onstatechange = () => this.attach();
    this.attach();
  }

  /** Which inputs to use: none (off), one by name, or all (null). */
  use(only: string | null, off: boolean) {
    if (this.chosen && only === this.only && off === this.off) return;
    this.chosen = true;
    this.only = only;
    this.off = off;
    this.attach();
  }

  private attach() {
    if (!this.access) return;
    const inputs: string[] = [];
    const listening: string[] = [];
    this.access.inputs.forEach((input) => {
      const name = input.name ?? input.id;
      inputs.push(name);
      if (this.chosen && !this.off && (this.only === null || name === this.only)) {
        listening.push(name);
        if (!input.onmidimessage)
          input.onmidimessage = (e) => {
            const hit = e.data && parseNoteOn(e.data);
            if (hit) this.onNote?.(hit.note, hit.velocity, name);
          };
      } else if (input.onmidimessage || input.connection === 'open') {
        input.onmidimessage = null;
        void input.close?.().catch(() => {});
      }
    });
    this.set({ status: 'ready', inputs, listening });
  }

  private set(s: MidiState) {
    this.state = s;
    this.onState?.(s);
  }
}

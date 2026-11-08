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

export type MidiState = { status: 'off' | 'asking' | 'ready' | 'unavailable'; inputs: string[] };

/** Listens to MIDI inputs and reports note-ons. One instance for the app. */
export class Midi {
  private access: MIDIAccess | null = null;
  /** Only this input (by name), or every input when null. */
  only: string | null = null;
  state: MidiState = { status: 'off', inputs: [] };
  onNote?: (note: number, velocity: number, input: string) => void;
  onState?: (s: MidiState) => void;

  async start() {
    if (this.access || this.state.status === 'asking') return;
    if (!navigator.requestMIDIAccess) return this.set({ status: 'unavailable', inputs: [] });
    this.set({ status: 'asking', inputs: [] });
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      return this.set({ status: 'unavailable', inputs: [] });
    }
    this.access.onstatechange = () => this.attach();
    this.attach();
  }

  private attach() {
    const inputs: string[] = [];
    this.access?.inputs.forEach((input) => {
      inputs.push(input.name ?? input.id);
      input.onmidimessage = (e) => {
        const name = input.name ?? input.id;
        if (this.only && name !== this.only) return;
        const hit = e.data && parseNoteOn(e.data);
        if (hit) this.onNote?.(hit.note, hit.velocity, name);
      };
    });
    this.set({ status: 'ready', inputs });
  }

  private set(s: MidiState) {
    this.state = s;
    this.onState?.(s);
  }
}

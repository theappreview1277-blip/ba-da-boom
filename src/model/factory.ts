import type { SampleRef } from './types';

// The factory kit is synthesised by scripts/make-factory-samples.mjs and released
// as CC0 by this project, so it is freely redistributable. See resources/samples/LICENSE.txt.
export const FACTORY_SAMPLES: { key: string; name: string }[] = [
  { key: 'kick', name: 'Kick' },
  { key: 'kick-sub', name: 'Sub Kick' },
  { key: 'snare', name: 'Snare' },
  { key: 'clap', name: 'Clap' },
  { key: 'rim', name: 'Rim' },
  { key: 'hat-closed', name: 'Closed Hat' },
  { key: 'hat-open', name: 'Open Hat' },
  { key: 'tom-low', name: 'Low Tom' },
  { key: 'tom-mid', name: 'Mid Tom' },
  { key: 'tom-high', name: 'High Tom' },
  { key: 'cowbell', name: 'Cowbell' },
  { key: 'clave', name: 'Clave' },
  { key: 'shaker', name: 'Shaker' },
  { key: 'crash', name: 'Crash' },
  { key: 'ride', name: 'Ride' },
  { key: 'conga', name: 'Conga' },
];

export function factorySampleRefs(): Record<string, SampleRef> {
  const out: Record<string, SampleRef> = {};
  for (const s of FACTORY_SAMPLES) {
    const id = `factory:${s.key}`;
    out[id] = { id, name: s.name, source: 'factory', file: `${s.key}.wav` };
  }
  return out;
}

/** Metronome clicks; registered with the engine but not shown in the browser or saved in projects. */
export const METRONOME_SAMPLES: SampleRef[] = ['metro-hi', 'metro-lo'].map((key) => ({
  id: `factory:${key}`,
  name: key,
  source: 'factory',
  file: `${key}.wav`,
}));

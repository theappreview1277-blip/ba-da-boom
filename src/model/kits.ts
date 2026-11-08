// Strudel's drum machine kits (tidal-drum-machines): which kit sound goes on
// which of the 16 tracks. A kit is a map from sound name (bd, sd, hh, …) to
// its sample files; index n is the n-th variant of that sound.

export type KitSounds = Record<string, string[]>;

/** Per track (factory order), the kit sounds to try, best first. */
const TRACK_SOUNDS: [string, number][][] = [
  [['bd', 0]], // Kick
  [['bd', 1], ['bd', 0]], // Sub Kick
  [['sd', 0]], // Snare
  [['cp', 0]], // Clap
  [['rim', 0]], // Rim
  [['hh', 0]], // Closed Hat
  [['oh', 0]], // Open Hat
  [['lt', 0]], // Low Tom
  [['mt', 0]], // Mid Tom
  [['ht', 0]], // High Tom
  [['cb', 0]], // Cowbell
  [['perc', 0]], // Clave
  [['sh', 0], ['tb', 0]], // Shaker
  [['cr', 0]], // Crash
  [['rd', 0]], // Ride
  [['perc', 1], ['tb', 0], ['misc', 0]], // Conga
];

export const SOUND_NAMES: Record<string, string> = {
  bd: 'Kick',
  sd: 'Snare',
  rim: 'Rim',
  cp: 'Clap',
  hh: 'Closed Hat',
  oh: 'Open Hat',
  cr: 'Crash',
  rd: 'Ride',
  sh: 'Shaker',
  ht: 'High Tom',
  mt: 'Mid Tom',
  lt: 'Low Tom',
  cb: 'Cowbell',
  tb: 'Tambourine',
  perc: 'Perc',
  misc: 'Misc',
  fx: 'FX',
};

/** For each track index, the [sound, variant] it gets from this kit, or null to keep its sample. */
export function kitAssignments(kit: KitSounds, trackCount: number): ([string, number] | null)[] {
  return Array.from({ length: trackCount }, (_, i) => TRACK_SOUNDS[i]?.find(([s, n]) => (kit[s]?.length ?? 0) > n) ?? null);
}

/** "RolandTR909" -> "Roland TR909", "AkaiMPC60" -> "Akai MPC60". */
export function kitLabel(name: string): string {
  return name.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}

export function kitSampleName(kit: string, sound: string, index: number, count: number): string {
  return `${kitLabel(kit)} ${SOUND_NAMES[sound] ?? sound}${count > 1 ? ` ${index + 1}` : ''}`;
}

/** Catalogue paths must be plain relative paths to .wav files. */
export function validKitPath(p: string): boolean {
  return /\.wav$/i.test(p) && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

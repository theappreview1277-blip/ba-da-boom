// The user's sample library: folders they added to the browser, favourite
// samples and the panel layout, kept in settings.json in the user data folder.
// Files are only ever read from inside a folder the user added.

import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { MIDI_MAPS, STEP_LANES, TOOL_TABS, type FolderListing, type Settings } from './ipc';
import { SAMPLE_FILE } from '../model/audioFiles';

const MAX_FILES_PER_FOLDER = 5000;
const MAX_DEPTH = 8;
const MAX_FAVOURITES = 2000;

const empty = (): Settings => ({ folders: [], favourites: [], layout: {}, sound: {} });

export async function readSettings(file: string): Promise<Settings> {
  try {
    return cleanSettings(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch {
    return empty();
  }
}

export function cleanSettings(raw: any): Settings {
  const s = empty();
  if (Array.isArray(raw?.folders)) s.folders = [...new Set<string>(raw.folders.filter((f: unknown) => typeof f === 'string' && isAbsolute(f)))];
  if (Array.isArray(raw?.favourites)) s.favourites = [...new Set<string>(raw.favourites.filter((f: unknown) => typeof f === 'string' && f.length < 4096))].slice(0, MAX_FAVOURITES);
  const width = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 80 && v <= 1200 ? Math.round(v) : undefined);
  const oneOf = <T extends string>(v: unknown, list: readonly T[]) => (list.includes(v as T) ? (v as T) : undefined);
  s.layout = {
    left: width(raw?.layout?.left),
    right: width(raw?.layout?.right),
    tool: oneOf(raw?.layout?.tool, TOOL_TABS),
    toolsOpen: typeof raw?.layout?.toolsOpen === 'boolean' ? raw.layout.toolsOpen : undefined,
    samples: typeof raw?.layout?.samples === 'boolean' ? raw.layout.samples : undefined,
    lane: oneOf(raw?.layout?.lane, STEP_LANES),
  };
  const text = (v: unknown, max = 300) => (typeof v === 'string' && v.length <= max ? v : undefined);
  const flag = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
  const o = raw?.sound?.output;
  s.sound = {
    output: text(o?.id) && text(o?.label) !== undefined ? { id: o.id, label: o.label } : undefined,
    midiInput: text(raw?.sound?.midiInput),
    midiOff: flag(raw?.sound?.midiOff),
    midiMap: oneOf(raw?.sound?.midiMap, MIDI_MAPS),
    padKeys: flag(raw?.sound?.padKeys),
    quantise: flag(raw?.sound?.quantise),
  };
  if (raw?.welcomed === true) s.welcomed = true;
  return s;
}

/** All sound files (WAV, MP3, FLAC, OGG) under a folder, as paths relative to it with / separators, sorted. */
export async function scanFolder(root: string): Promise<FolderListing> {
  const files: string[] = [];
  let truncated = false;
  let readable = true;
  const walk = async (dir: string, depth: number) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      if (depth === 0) readable = false;
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    for (const e of entries) {
      if (files.length >= MAX_FILES_PER_FOLDER) {
        truncated = true;
        return;
      }
      if (e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory() && depth < MAX_DEPTH) await walk(full, depth + 1);
      else if (e.isFile() && SAMPLE_FILE.test(e.name)) files.push(relative(root, full).split(sep).join('/'));
    }
  };
  await walk(root, 0);
  return { path: root, files, truncated, readable };
}

/** The absolute path of a file in one of the user's folders, or null if it would leave that folder. */
export function resolveInFolder(folders: string[], root: unknown, rel: unknown): string | null {
  if (typeof root !== 'string' || typeof rel !== 'string' || !folders.includes(root)) return null;
  if (!SAMPLE_FILE.test(rel) || rel.includes('\0') || isAbsolute(rel)) return null;
  const full = resolve(root, ...rel.split('/'));
  const back = relative(root, full);
  if (!back || back.startsWith('..') || isAbsolute(back)) return null;
  return full;
}

// Strudel's drum machine kits (tidal-drum-machines; the file list is
// strudel-kits.json, from Strudel's dough-samples map). The installer includes
// every kit (scripts/fetch-kits.mjs puts them in resources/kits); a file that is
// not there is downloaded from tidal-drum-machines, as strudel.cc does. Picked
// kits are copied into the sample pool, which projects already know how to use.

import { app, net } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { KitProgress, KitResult, KitSample } from './ipc';
import { validKitPath as validPath } from '../model/kits';
import catalogue from './strudel-kits.json';

const KITS = catalogue.kits as Record<string, Record<string, string[]>>;
const MAX_KIT_FILE_BYTES = 20 * 1024 * 1024;
const PARALLEL = 6;

/**
 * Where kit files come from. Normally the bundled folder, then the network.
 * Tests set BDB_KITS_SOURCE to "bundled" (no network) or to a URL (network only).
 */
function sources(): { dir: string | null; base: string | null } {
  const env = process.env.BDB_KITS_SOURCE;
  const dir = app.isPackaged ? join(process.resourcesPath, 'kits') : join(app.getAppPath(), 'resources', 'kits');
  if (env === 'bundled') return { dir, base: null };
  if (env) return { dir: null, base: env };
  return { dir, base: catalogue.base };
}

export function kitList(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [name, sounds] of Object.entries(KITS)) out[name] = Object.fromEntries(Object.entries(sounds).map(([s, files]) => [s, files.length]));
  return out;
}

interface Deps {
  cacheDir: string;
  poolHas: (file: string) => boolean;
  addToPool: (buf: Buffer) => Promise<string>;
  isWav: (buf: Buffer) => boolean;
  progress: (p: KitProgress) => void;
}

async function fetchWav(url: string, isWav: (b: Buffer) => boolean): Promise<Buffer> {
  const res = await net.fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_KIT_FILE_BYTES) throw new Error('file too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_KIT_FILE_BYTES || !isWav(buf)) throw new Error('not a WAV file');
  return buf;
}

export async function downloadKit(name: unknown, deps: Deps): Promise<KitResult> {
  if (typeof name !== 'string' || !Object.hasOwn(KITS, name)) throw new Error('Unknown kit');
  const sounds = KITS[name];
  const jobs = Object.entries(sounds).flatMap(([sound, files]) => files.filter(validPath).map((path, index) => ({ sound, index, path })));
  // Cache index: catalogue path -> pool file. Entries whose pool file is gone are fetched again.
  const indexFile = join(deps.cacheDir, `${name}.json`);
  let cache: Record<string, string> = {};
  try {
    cache = JSON.parse(await fs.readFile(indexFile, 'utf8'));
  } catch {
    cache = {};
  }
  const samples: KitSample[] = [];
  let failed = 0;
  let fetched = 0;
  let stored = 0;
  let done = 0;
  const src = sources();
  const base = src.base?.replace(/\/?$/, '/') ?? null;
  const read = async (path: string): Promise<Buffer> => {
    if (src.dir) {
      const buf = await fs.readFile(join(src.dir, ...path.split('/'))).catch(() => null);
      if (buf && deps.isWav(buf)) return buf;
    }
    if (!base) throw new Error('not bundled');
    const buf = await fetchWav(base + path.split('/').map(encodeURIComponent).join('/'), deps.isWav);
    fetched++;
    return buf;
  };
  deps.progress({ kit: name, done, total: jobs.length });
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        let file = cache[job.path];
        if (!file || !/^[0-9a-f]{32}\.wav$/.test(file) || !deps.poolHas(file)) {
          file = await deps.addToPool(await read(job.path));
          cache[job.path] = file;
          stored++;
        }
        samples.push({ sound: job.sound, index: job.index, file });
      } catch {
        failed++;
      }
      deps.progress({ kit: name, done: ++done, total: jobs.length });
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  if (!samples.length) throw new Error(`Could not get ${name}${base ? '. Check the internet connection and try again.' : ' (not included in this build).'}`);
  if (stored) {
    await fs.mkdir(deps.cacheDir, { recursive: true });
    await fs.writeFile(indexFile, JSON.stringify(cache));
  }
  samples.sort((a, b) => a.sound.localeCompare(b.sound) || a.index - b.index);
  return { kit: name, sounds: kitList()[name], samples, failed, downloaded: fetched };
}


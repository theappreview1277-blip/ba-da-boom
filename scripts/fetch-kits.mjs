// Downloads Strudel's drum machine kits (tidal-drum-machines, the list in
// src/main/strudel-kits.json) into resources/kits/, which the installer
// includes so every kit works offline. Files already there are kept, so only
// the first build downloads (about 190 MB). Not committed to git.
// Exits non-zero if any file is missing or not a WAV.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const catalogue = JSON.parse(readFileSync('src/main/strudel-kits.json', 'utf8'));
const OUT = 'resources/kits';
const isWav = (b) => b.length > 44 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE';
const jobs = Object.values(catalogue.kits).flatMap((k) => Object.values(k).flat());
let fetched = 0;
let next = 0;
const failed = [];

async function get(path) {
  const url = catalogue.base + path.split('/').map(encodeURIComponent).join('/');
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!isWav(buf)) throw new Error('not a WAV file');
      return buf;
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

async function worker() {
  for (let path = jobs[next++]; path; path = jobs[next++]) {
    const file = join(OUT, path);
    if (existsSync(file) && statSync(file).size > 44) continue;
    try {
      const buf = await get(path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.part`, buf);
      renameSync(`${file}.part`, file);
      fetched++;
    } catch (e) {
      failed.push(`${path}: ${e.message}`);
    }
  }
}

await Promise.all(Array.from({ length: 12 }, worker));
writeFileSync(
  join(OUT, 'SOURCE.txt'),
  [
    "Strudel's drum machine kits, from tidal-drum-machines:",
    '  https://github.com/ritchse/tidal-drum-machines',
    `  file list: ${catalogue.source}`,
    'No licence is stated for these samples.',
    '',
  ].join('\n'),
);
console.log(`kits: ${jobs.length - failed.length} of ${jobs.length} files ready (${fetched} downloaded now)`);
if (failed.length) {
  console.error(`kits: ${failed.length} files failed:\n  ${failed.slice(0, 20).join('\n  ')}`);
  process.exit(1);
}

// Typing the tempo, and Strudel's drum machine kits through the real UI: the
// Kit menu, loading with progress (from a local test server standing in for
// GitHub, so failures can be simulated), tracks getting the kit's sounds,
// caching, undo, Factory, save/reopen, a failed download, the kits included
// with the app (no network), and one real download from GitHub.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, openSync, readSync, closeSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { closeApp, launchApp, newProfile, runStandalone, stubDialogs } from './lib.mjs';

/** A short 16-bit mono WAV whose pitch depends on the path, so every file has its own content hash. */
function wavFor(path) {
  const rate = 44100;
  const n = 4410;
  const hash = createHash('md5').update(path).digest();
  const freq = 100 + (hash[0] % 200) * 5;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 20000 * (1 - i / n)), 44 + i * 2);
  // The path's hash in the last samples makes every file unique.
  for (let i = 0; i < 16; i++) buf.writeInt16LE(hash[i], 44 + (n - 16 + i) * 2);
  return buf;
}

function startServer() {
  const hits = [];
  const server = createServer((req, res) => {
    const path = decodeURIComponent(req.url.slice(1));
    hits.push(path);
    if (path.startsWith('BossDR110/')) return res.writeHead(500).end('down');
    if (path === 'RolandTR909/rolandtr909-rd/rd04.wav') return res.writeHead(404).end('missing');
    res.writeHead(200, { 'content-type': 'audio/wav' }).end(wavFor(path));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, hits, base: `http://127.0.0.1:${server.address().port}/` })));
}

export async function run(t) {
  const { server, hits, base } = await startServer();
  const { app, win, pageErrors } = await launchApp(undefined, [], { BDB_KITS_SOURCE: base });
  try {
    const project = () => win.evaluate(() => window.__engine['project']);
    const bpmBox = 'input[aria-label=BPM]';
    const typeBpm = async (text, key = 'Enter') => {
      await win.click(bpmBox);
      await win.keyboard.type(text);
      if (key) await win.keyboard.press(key);
      return (await project()).bpm;
    };

    // --- Tempo entry ---
    t.check('typing 90 sets 90 BPM (no snapping back on the way)', (await typeBpm('90')) === 90);
    t.check('the BPM box shows the new tempo', (await win.inputValue(bpmBox)) === '90');
    t.check('typing digits does not trigger shortcuts (still on pattern A)', (await project()).currentPatternId === (await project()).patterns[0].id);
    t.check('decimals are kept to one place (95.55 -> 95.6)', (await typeBpm('95.55')) === 95.6);
    t.check('too fast is limited to 300', (await typeBpm('500')) === 300);
    t.check('too slow is limited to 20', (await typeBpm('5')) === 20);
    t.check('letters are ignored (tempo unchanged)', (await typeBpm('abc')) === 20 && (await win.inputValue(bpmBox)) === '20');
    t.check('Escape throws away what was typed', (await typeBpm('150', 'Escape')) === 20 && (await win.inputValue(bpmBox)) === '20');
    await typeBpm('120');
    await win.click(bpmBox);
    await win.keyboard.press('ArrowUp');
    const up = (await project()).bpm;
    await win.keyboard.press('Shift+ArrowUp');
    t.check('arrow keys step by 1, Shift+arrow by 10', up === 121 && (await project()).bpm === 131, `${up}, ${(await project()).bpm}`);
    await win.keyboard.press('Control+a');
    await win.keyboard.type('128');
    await win.click('.grid .ruler');
    t.check('clicking away applies the typed tempo', (await project()).bpm === 128);
    await win.keyboard.press('Control+z');
    t.check('undo goes back to the tempo before it', (await project()).bpm === 131, (await project()).bpm);
    t.check('the engine plays at the typed tempo', await win.evaluate(() => Math.abs(window.__engine['project'].bpm - 131) < 1e-9));

    // --- Kits ---
    const options = await win.$$eval('select[aria-label=Kit] option', (o) => o.map((x) => x.value));
    t.check('the Kit menu has Factory plus all 71 Strudel drum machines', options[0] === 'factory' && options.length === 72 && options.includes('RolandTR909') && options.includes('LinnDrum'), options.length);
    t.check('it starts on Factory', (await win.inputValue('select[aria-label=Kit]')) === 'factory');

    await win.selectOption('select[aria-label=Kit]', 'RolandTR909');
    const sawProgress = await win.waitForSelector('.kit-progress', { timeout: 5000 }).then(() => true, () => false);
    await win.waitForFunction(() => window.__lastKit?.kit === 'RolandTR909', null, { timeout: 60000 }).catch(() => {});
    const k = await win.evaluate(() => window.__lastKit);
    t.check('picking a kit shows download progress', sawProgress);
    t.check('the whole kit is downloaded (74 files, 1 missing on the server)', hits.filter((h) => h.startsWith('RolandTR909/')).length === 74 && k?.samples.length === 73 && k.failed === 1, `${hits.length} requests, ${k?.samples.length} ok, ${k?.failed} failed`);
    let p = await project();
    const kitOf = (p, i) => p.samples[p.tracks[i].sound.sampleId]?.kit;
    t.check('12 tracks get TR909 sounds (kick, snare, hats, toms, crash, ride…)', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 14].every((i) => kitOf(p, i) === 'RolandTR909') && k.assigned === 12);
    t.check('tracks the kit has no sound for keep theirs (cowbell, clave, shaker, conga)', [10, 11, 12, 15].every((i) => p.tracks[i].sound.sampleId.startsWith('factory:')) && k.kept.join() === 'Cowbell,Clave,Shaker,Conga', k.kept.join());
    t.check('the kick is the first TR909 bass drum', p.samples[p.tracks[0].sound.sampleId]?.name === 'Roland TR909 Kick 1', p.samples[p.tracks[0].sound.sampleId]?.name);
    const toast = await win.textContent('.toast').catch(() => '');
    t.check('a message says what happened, including the file that failed', /Roland TR909 downloaded: on 12 of 16 tracks/.test(toast) && /1 file could not be loaded/.test(toast), toast);
    await win.waitForFunction(() => window.__engine['project'].tracks.every((t) => window.__engine.sampleStatus(t.sound.sampleId) === 'ok'), null, { timeout: 15000 }).catch(() => {});
    t.check('every kit sound loads in the audio engine', await win.evaluate(() => window.__engine['project'].tracks.every((t) => window.__engine.sampleStatus(t.sound.sampleId) === 'ok')));
    t.check('the Kit menu shows Roland TR909', (await win.inputValue('select[aria-label=Kit]')) === 'RolandTR909');
    const group = await win.$$eval('.browser-group', (gs) => gs.map((g) => [g.querySelector('h4').textContent, g.querySelectorAll('li').length]));
    t.check('the sample list has a Roland TR909 group with every sound', group.some(([h, n]) => h === 'Roland TR909' && n === 73), JSON.stringify(group));

    // Plays and exports with the kit.
    const out = newProfile();
    await stubDialogs(app, { savePath: join(out, 'kit.wav') });
    await win.keyboard.press('Control+e');
    await win.check('input[name=export-format] >> nth=0');
    await win.evaluate(() => (window.__lastExportInfo = null));
    await win.click('.modal button.primary');
    await win.waitForFunction(() => window.__lastExportInfo, null, { timeout: 60000 }).catch(() => {});
    const ex = await win.evaluate(() => window.__lastExportInfo);
    t.check('the beat exports with the kit sounds (all 14 hits, audible)', ex?.events === 14 && ex.peak > 0.01, ex && `${ex.events} hits, peak ${ex.peak?.toFixed(2)}`);

    await win.keyboard.press('Control+z');
    p = await project();
    t.check('undo puts the factory sounds back in one step', p.tracks.every((tr) => tr.sound.sampleId.startsWith('factory:')) && (await win.inputValue('select[aria-label=Kit]')) === 'factory');

    const before = hits.length;
    await win.evaluate(() => (window.__lastKit = null));
    await win.selectOption('select[aria-label=Kit]', 'RolandTR909');
    await win.waitForFunction(() => window.__lastKit?.kit === 'RolandTR909', null, { timeout: 60000 }).catch(() => {});
    const again = await win.evaluate(() => window.__lastKit);
    t.check('picking it again uses the downloaded copy (only the missing file is retried)', hits.length - before === 1 && again?.downloaded === 0 && again.assigned === 12, `${hits.length - before} requests`);

    await win.selectOption('select[aria-label=Kit]', 'factory');
    p = await project();
    t.check('Factory puts the factory sounds on every track', p.tracks.every((tr, i) => tr.sound.sampleId.startsWith('factory:')) && p.tracks[0].sound.sampleId === 'factory:kick');
    await win.keyboard.press('Control+z');

    // A kit whose server is down: nothing changes, and the message says so.
    await win.evaluate(() => (window.__lastKit = null));
    const snapshot = JSON.stringify((await project()).tracks);
    await win.selectOption('select[aria-label=Kit]', 'BossDR110');
    await win.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('Could not load'), null, { timeout: 30000 }).catch(() => {});
    const err = await win.textContent('.toast').catch(() => '');
    t.check('a failed download says so and changes nothing', /Could not load Boss DR110: Could not get BossDR110\. Check the internet connection/.test(err) && JSON.stringify((await project()).tracks) === snapshot, err);
    await win.waitForFunction(() => !document.querySelector('select[aria-label=Kit]').disabled, null, { timeout: 5000 }).catch(() => {});
    t.check('after a failure the Kit menu shows the kit in use again', (await win.inputValue('select[aria-label=Kit]')) === 'RolandTR909');

    // Saved projects carry the kit sounds with them.
    const work = newProfile();
    await stubDialogs(app, { savePath: join(work, 'Kit.badaboom'), openPath: join(work, 'Kit', 'Kit.badaboom') });
    await win.keyboard.press('Control+s');
    await win.waitForFunction(() => !document.querySelector('.statusbar')?.textContent?.includes('unsaved'), null, { timeout: 15000 }).catch(() => {});
    const saved = JSON.stringify((await project()).tracks.map((tr) => tr.sound.sampleId));
    await win.keyboard.press('Control+o');
    await win.waitForTimeout(1500);
    p = await project();
    await win.waitForFunction(() => window.__engine['project'].tracks.every((t) => window.__engine.sampleStatus(t.sound.sampleId) === 'ok'), null, { timeout: 15000 }).catch(() => {});
    const okAfter = await win.evaluate(() => window.__engine['project'].tracks.every((t) => window.__engine.sampleStatus(t.sound.sampleId) === 'ok'));
    t.check('save and reopen keeps the kit sounds, and they load', JSON.stringify(p.tracks.map((tr) => tr.sound.sampleId)) === saved && kitOf(p, 0) === 'RolandTR909' && okAfter);
    t.check('no errors in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
  } finally {
    await closeApp(app, win).catch(() => app.close());
    server.close();
  }

  // The kits included with the app: every file is there, and a kit loads with no network.
  {
    const catalogue = JSON.parse(readFileSync('src/main/strudel-kits.json', 'utf8'));
    const dir = process.env.ELECTRON_EXE ? join(dirname(process.env.ELECTRON_EXE), 'resources', 'kits') : join('resources', 'kits');
    const paths = Object.values(catalogue.kits).flatMap((k) => Object.values(k).flat());
    const head = Buffer.alloc(12);
    const bad = paths.filter((p) => {
      const f = join(dir, ...p.split('/'));
      if (!existsSync(f)) return true;
      const fd = openSync(f, 'r');
      readSync(fd, head, 0, 12, 0);
      closeSync(fd);
      return head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE';
    });
    t.check(`all ${paths.length} kit files are included with the app`, bad.length === 0, bad.length ? `${bad.length} missing, e.g. ${bad[0]}` : dir);

    const { app, win, pageErrors } = await launchApp(undefined, [], { BDB_KITS_SOURCE: 'bundled' });
    try {
      await win.selectOption('select[aria-label=Kit]', 'RolandTR808');
      await win.waitForFunction(() => window.__lastKit?.kit === 'RolandTR808' || document.querySelector('.toast')?.textContent?.includes('Could not'), null, { timeout: 60000 }).catch(() => {});
      const k = await win.evaluate(() => window.__lastKit);
      await win.waitForFunction(() => window.__engine['project'].tracks.every((t) => window.__engine.sampleStatus(t.sound.sampleId) === 'ok'), null, { timeout: 15000 }).catch(() => {});
      const ok = await win.evaluate(() => window.__engine['project'].tracks.every((t) => window.__engine.sampleStatus(t.sound.sampleId) === 'ok'));
      t.check('the TR808 loads from the included kits with no internet (122 files)', k?.samples.length === 122 && k.failed === 0 && k.downloaded === 0 && ok, k ? `${k.samples.length} files, ${k.failed} failed, ${k.downloaded} downloaded` : await win.textContent('.toast').catch(() => 'no result'));
      t.check('no errors in the page (included kits)', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
    } finally {
      await closeApp(app, win).catch(() => app.close());
    }
  }

  // A kit file missing from a build is downloaded from where Strudel gets it (needs internet).
  {
    const { app, win, pageErrors } = await launchApp(undefined, [], { BDB_KITS_SOURCE: 'https://raw.githubusercontent.com/ritchse/tidal-drum-machines/main/machines/' });
    try {
      await win.selectOption('select[aria-label=Kit]', 'CasioVL1');
      await win.waitForFunction(() => window.__lastKit?.kit === 'CasioVL1' || document.querySelector('.toast')?.textContent?.includes('Could not'), null, { timeout: 60000 }).catch(() => {});
      const k = await win.evaluate(() => window.__lastKit);
      await win.waitForFunction(() => window.__engine.sampleStatus(window.__engine['project'].tracks[0].sound.sampleId) === 'ok', null, { timeout: 15000 }).catch(() => {});
      const ok = await win.evaluate(() => window.__engine.sampleStatus(window.__engine['project'].tracks[0].sound.sampleId) === 'ok');
      t.check('a real kit (Casio VL-1) downloads from GitHub and plays', k?.samples.length === 3 && k.failed === 0 && k.downloaded === 3 && ok, k ? `${k.samples.length} files, ${k.failed} failed` : await win.textContent('.toast').catch(() => 'no result'));
      t.check('no errors in the page (real download)', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
    } finally {
      await closeApp(app, win).catch(() => app.close());
    }
  }
}

await runStandalone(import.meta.url, 'Tempo entry and kits', run);

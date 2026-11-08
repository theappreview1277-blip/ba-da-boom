// MP3, FLAC and OGG sounds, through the real UI: importing each format, the
// sample pool only ever holding WAV, folders listing the new formats, a broken
// MP3 and an unknown file refused with a message, playing a converted sound,
// and saving a project that uses them.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeApp, launchApp, newProfile, runStandalone, stubDialogs } from './lib.mjs';

const FIX = 'test/fixtures/sounds';
/** Seconds of sound in a WAV file, or null if it isn't one. */
function wavSeconds(file) {
  const b = readFileSync(file);
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') return null;
  return b.readUInt32LE(40) / b.readUInt32LE(28);
}

export async function run(t) {
  const profile = newProfile();
  const work = newProfile();
  const folder = join(work, 'Mixed');
  mkdirSync(folder);
  copyFileSync(join(FIX, 'tone.mp3'), join(folder, 'Song bit.mp3'));
  copyFileSync(join(FIX, 'other.flac'), join(folder, 'Lossless.flac'));
  copyFileSync(join(FIX, 'tone.ogg'), join(folder, 'Vorbis.ogg'));
  copyFileSync('resources/samples/kick-sub.wav', join(folder, 'Kick.wav'));
  writeFileSync(join(folder, 'notes.txt'), 'not a sound');

  let { app, win, pageErrors } = await launchApp(profile);
  const project = () => win.evaluate(() => window.__engine['project']);
  const toast = () => win.textContent('.toast').catch(() => '');
  const pool = join(profile, 'sample-pool');
  try {
    // 1. Import one file of each format.
    for (const [name, src, mime] of [
      ['Tone MP3.mp3', 'tone.mp3', 'audio/mpeg'],
      ['Tone FLAC.flac', 'tone.flac', 'audio/flac'],
      ['Tone OGG.ogg', 'tone.ogg', 'audio/ogg'],
    ]) {
      await win.setInputFiles('.browser input[type=file]', { name, mimeType: mime, buffer: readFileSync(join(FIX, src)) });
      const label = name.replace(/\.\w+$/, '');
      await win.waitForSelector(`.sample:has-text("${label}")`, { timeout: 10000 }).catch(() => {});
      const p = await project();
      const ref = Object.values(p.samples).find((s) => s.originalName === name);
      const file = ref && join(pool, ref.file);
      const secs = file && existsSync(file) ? wavSeconds(file) : null;
      const fmt = name.split('.').pop().toUpperCase();
      t.check(`an ${fmt} file can be imported`, !!ref && ref.name === label, ref?.name ?? (await toast()));
      t.check(`the ${fmt} sound is kept as a WAV of the same length`, ref?.file.endsWith('.wav') && secs !== null && secs > 0.45 && secs < 0.6, secs);
      await win.waitForFunction((id) => window.__engine.sampleStatus(id) === 'ok', ref?.id, { timeout: 10000 }).catch(() => {});
      t.check(`the ${fmt} sound loads in the engine`, await win.evaluate((id) => window.__engine.sampleStatus(id) === 'ok', ref?.id));
    }
    t.check('the sample pool only holds WAV files', readdirSync(pool).every((f) => /^[0-9a-f]{32}\.wav$/.test(f)), readdirSync(pool).join(', '));

    // 2. Bad files are refused with a message and change nothing.
    const snap = JSON.stringify(await project());
    await win.setInputFiles('.browser input[type=file]', { name: 'Broken.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('this is not an mp3 at all '.repeat(40)) });
    await win.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('Broken.mp3'), null, { timeout: 10000 }).catch(() => {});
    t.check('a broken MP3 is refused with a clear message', /Broken\.mp3 could not be read as MP3 audio/.test(await toast()) && JSON.stringify(await project()) === snap, await toast());
    await win.setInputFiles('.browser input[type=file]', { name: 'song.aiff', mimeType: 'audio/aiff', buffer: Buffer.from('FORM') });
    await win.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('song.aiff'), null, { timeout: 10000 }).catch(() => {});
    t.check('an unknown format names the ones that work', /use WAV, MP3, FLAC or OGG/.test(await toast()) && JSON.stringify(await project()) === snap, await toast());

    // 3. A folder with mixed formats.
    await stubDialogs(app, { openPath: folder });
    await win.click('button:has-text("Add folder…")');
    const group = win.locator('.browser-group.folder', { has: win.locator('h4:text-is("Mixed")') });
    await group.waitFor({ timeout: 10000 }).catch(() => {});
    const names = await group.locator('li .name').allTextContents();
    t.check('a folder lists WAV, MP3, FLAC and OGG files (not other files)', JSON.stringify(names) === JSON.stringify(['Kick', 'Lossless', 'Song bit', 'Vorbis']), names.join(', '));
    await win.click('.row >> nth=1 >> .track-name');
    await group.locator('li:has-text("Lossless")').dblclick();
    await win.waitForFunction(() => window.__engine['project'].tracks[1].sound.sampleId.startsWith('user:'), null, { timeout: 10000 }).catch(() => {});
    let p = await project();
    let ref = p.samples[p.tracks[1].sound.sampleId];
    t.check('double-clicking a FLAC in a folder puts it on the track', ref?.name === 'Lossless' && ref.originalName === 'Lossless.flac', ref?.originalName);
    t.check('the folder FLAC is stored as a WAV', !!ref && wavSeconds(join(pool, ref.file)) > 0.45);
    await group.locator('li:has-text("Song bit")').click();
    await win.waitForFunction(() => window.__lastPreview?.name === 'Song bit', null, { timeout: 10000 }).catch(() => {});
    const prev = await win.evaluate(() => window.__lastPreview);
    t.check('clicking an MP3 in a folder plays it', prev?.name === 'Song bit' && (await win.evaluate((id) => window.__engine.sampleStatus(id) === 'ok', prev.id)), prev?.name);

    // 4. Play a beat that uses the converted sounds.
    await win.evaluate(() => document.activeElement?.blur());
    for (const s of [0, 4, 8, 12]) await win.click(`[data-cell="${p.tracks[1].id}:${s}"]`);
    await win.keyboard.press('Space');
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      await win.waitForTimeout(50);
      peak = Math.max(peak, await win.evaluate(() => window.__engine.readMeters(16).tracks[1] ?? 0));
    }
    await win.keyboard.press('Space');
    t.check('the beat plays with the converted sound (track 2 meter moves)', peak > 0.01, peak.toFixed(3));

    // 5. Save collects the converted sounds as WAV.
    await stubDialogs(app, { savePath: join(work, 'Formats.badaboom') });
    await win.keyboard.press('Control+s');
    const samplesDir = join(work, 'Formats', 'samples');
    for (let i = 0; i < 40 && !existsSync(samplesDir); i++) await win.waitForTimeout(250);
    const collected = existsSync(samplesDir) ? readdirSync(samplesDir) : [];
    t.check('saving copies the sounds into the project as WAV', collected.length >= 1 && collected.every((f) => wavSeconds(join(samplesDir, f)) !== null), collected.join(', '));
    t.check('no page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
  } finally {
    await closeApp(app, win);
  }
}

await runStandalone(import.meta.url, 'MP3, FLAC and OGG sounds', run);

// Stem and MIDI export through the real export dialog: one WAV per audible
// track, all the same length, muted tracks left out; MIDI with one note per
// hit on channel 10 with General MIDI drum notes.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { closeApp, launchApp, newProfile, runStandalone, stubDialogs } from './lib.mjs';

/** Note-ons (velocity > 0) in a format 1 SMF, with their track index, tick and channel. */
function readMidi(buf) {
  const u32 = (o) => buf.readUInt32BE(o);
  const header = { format: buf.readUInt16BE(8), tracks: buf.readUInt16BE(10), ppq: buf.readUInt16BE(12) };
  const notes = [];
  let off = 14;
  for (let t = 0; t < header.tracks; t++) {
    if (buf.toString('latin1', off, off + 4) !== 'MTrk') throw new Error(`track ${t} has no MTrk`);
    const end = off + 8 + u32(off + 4);
    let p = off + 8;
    let tick = 0;
    const varLen = () => {
      let n = 0;
      let b;
      do {
        b = buf[p++];
        n = (n << 7) | (b & 0x7f);
      } while (b & 0x80);
      return n;
    };
    while (p < end) {
      tick += varLen();
      const status = buf[p++];
      if (status === 0xff) {
        p++;
        const len = varLen();
        p += len;
      } else if ((status & 0xf0) === 0x90 || (status & 0xf0) === 0x80) {
        const note = buf[p++];
        const vel = buf[p++];
        if ((status & 0xf0) === 0x90 && vel > 0) notes.push({ track: t, tick, channel: (status & 0x0f) + 1, note, vel });
      } else throw new Error(`unexpected status ${status.toString(16)}`);
    }
    off = end;
  }
  return { header, notes };
}

export async function run(t) {
  const { app, win, pageErrors } = await launchApp();
  const work = newProfile();
  try {
    const exportWith = async (format) => {
      await win.keyboard.press('Control+e');
      await win.waitForSelector('.modal');
      await win.check(`input[name=export-format] >> nth=${format}`);
      await win.evaluate(() => (window.__lastExportInfo = null));
      await win.click('.modal button.primary');
      await win.waitForFunction(() => window.__lastExportInfo, null, { timeout: 120000 }).catch(() => {});
      await win.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 10000 }).catch(() => {});
      return win.evaluate(() => window.__lastExportInfo);
    };
    // Reference: the plain WAV mix of pattern A (one bar).
    await stubDialogs(app, { savePath: join(work, 'mix.wav') });
    const mix = await exportWith(0);
    const audible = await win.evaluate(() => {
      const p = window.__engine['project'];
      const pat = p.patterns.find((x) => x.id === p.currentPatternId);
      return p.tracks.map((tr, i) => (pat.lanes[tr.id]?.steps ?? []).some((s) => s.on)).flatMap((on, i) => (on ? [i] : []));
    });

    // Stems.
    await stubDialogs(app, { openPath: work });
    let info = await exportWith(1);
    const dir = readdirSync(work).find((n) => n.endsWith(' stems'));
    const files = dir ? readdirSync(join(work, dir)).sort() : [];
    t.check('stems are written into a "<name> stems" folder', !!dir && files.length > 0, dir);
    t.check('one stem per track with hits', info?.format === 'stems' && JSON.stringify(info.stems.map((s) => s.track)) === JSON.stringify(audible), info?.stems?.map((s) => s.track).join(','));
    t.check('every stem file is on disk with its track name', files.length === info?.files?.length && info.files.every((f) => files.includes(f)) && files[0].startsWith('01 '), files.slice(0, 4).join(', '));
    const sizes = files.map((f) => statSync(join(work, dir, f)).size);
    t.check('all stems have the same length (they line up in a DAW)', sizes.length > 1 && sizes.every((s) => s === sizes[0]) && info.stems.every((s) => s.frames === info.stems[0].frames), sizes.join(','));
    const head = files.length ? readFileSync(join(work, dir, files[0])) : Buffer.alloc(0);
    t.check('stems are 24-bit WAV files', head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WAVE' && head.readUInt16LE(34) === 24);
    t.check('the stems hold every hit of the mix', info?.stems?.reduce((n, s) => n + s.events, 0) === mix?.events, `${info?.stems?.reduce((n, s) => n + s.events, 0)} vs ${mix?.events}`);
    t.check('every stem has sound in it', info?.stems?.every((s) => s.peak > 0.001));

    // A muted track gets no stem.
    await win.click(`.grid .row[role=row]:has(.track-head) >> nth=${audible[0]} >> button[title="Mute (M)"]`);
    const work2 = newProfile();
    await stubDialogs(app, { openPath: work2 });
    info = await exportWith(1);
    t.check('a muted track is left out of the stems', info?.stems?.length === audible.length - 1 && !info.stems.some((s) => s.track === audible[0]), info?.stems?.map((s) => s.track).join(','));
    await win.keyboard.press('Control+z');

    // MIDI.
    const midPath = join(work, 'beat.mid');
    await stubDialogs(app, { savePath: midPath });
    info = await exportWith(2);
    t.check('MIDI export reports one note per hit', info?.format === 'midi' && info.notes === mix?.events, `${info?.notes} notes, mix has ${mix?.events}`);
    t.check('MIDI file written', existsSync(midPath));
    const midi = existsSync(midPath) ? readMidi(readFileSync(midPath)) : null;
    t.check('it is a format 1 MIDI file at 480 PPQ with a track per drum plus tempo', midi?.header.format === 1 && midi.header.ppq === 480 && midi.header.tracks === audible.length + 1, midi && JSON.stringify(midi.header));
    t.check('every note is on channel 10 (drums)', midi?.notes.length === info?.notes && midi.notes.every((n) => n.channel === 10), midi?.notes.length);
    t.check('the kick plays General MIDI note 36 on the first beat', midi?.notes.some((n) => n.note === 36 && n.tick === 0));
    t.check('notes stay inside the exported bar', midi?.notes.every((n) => n.tick < 480 * 4));
    t.check('no errors in the page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
  } finally {
    await closeApp(app, win).catch(() => app.close());
  }
}

await runStandalone(import.meta.url, 'Stem and MIDI export', run);

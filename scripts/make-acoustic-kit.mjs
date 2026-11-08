// Builds the Acoustic Kit (resources/acoustic/) from Virtuosity Drums, a CC0
// sampled jazz/club kit (https://github.com/sfzinstruments/virtuosity_drums,
// pinned below). One hit per sound, from the middle microphone pair: trimmed,
// faded, set to a mixed level (drums near full
// scale, cymbals and shakers lower, as in a played kit) and saved as 16-bit 44.1 kHz WAV. The
// result is committed, so this only needs running to change the kit. Needs ffmpeg.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const COMMIT = '9f04cf9a734527edfbb0a4eee1f674e45bbf71bc';
const BASE = `https://raw.githubusercontent.com/sfzinstruments/virtuosity_drums/${COMMIT}/Samples/`;
const OUT = 'resources/acoustic/AcousticKit';

/** Kit sound -> [source file, longest length in seconds] per variant. */
const PICKS = {
  bd: [['mid/kick/mid_kick_snoff_vl4_rr1.flac', 1.5], ['mid/kick/mid_kick_snon_vl3_rr1.flac', 1.5]],
  sd: [['mid/snare/mid_snare_center_vl30.flac', 1.5], ['mid/snare/mid_snare_rimshot_vl10.flac', 1.5]],
  rim: [['mid/snare/mid_snare_crossstick_vl12.flac', 0.8]],
  hh: [['mid/hh/mid_hh_closed_vl3_rr1.flac', 0.8], ['mid/hh/mid_hh_34_vl3_rr1.flac', 1.2]],
  oh: [['mid/hh/mid_hh_open_vl3_rr1.flac', 2.5]],
  lt: [['mid/ltom/mid_ltom_center_vl12.flac', 2]],
  mt: [['mid/htom/mid_htom_offcenter_vl12.flac', 2]],
  ht: [['mid/htom/mid_htom_center_vl12.flac', 2]],
  cb: [['perc/mid/cowbell/Cowbell1_Normal_v3_rr1_Mid.wav', 1]],
  perc: [['perc/mid/claves/Claves1_Hit_v3_rr1_Mid.wav', 1], ['perc/mid/conga/Conga_22_HitN_51_100_rr1_Mid.wav', 1.2]],
  sh: [['perc/mid/shaker/LShaker_Shake1D_rr1_Mid.wav', 1]],
  tb: [['perc/mid/tambourine/Tamb1_Shake_rr1_Mid.wav', 1.2]],
  cr: [['mid/crash/mid_crash_crash_vl3_rr1.flac', 4]],
  rd: [['mid/ride/mid_ride_ride_vl3_rr1.flac', 3.5], ['mid/ride/mid_ride_bell_vl3_rr1.flac', 3.5]],
};

/** Peak level per sound in dBFS, so the kit is balanced when every track is at the same volume. */
const LEVEL = { bd: -1, sd: -1, rim: -4, hh: -9, oh: -7, lt: -2, mt: -2, ht: -2, cb: -7, perc: -5, sh: -10, tb: -9, cr: -6, rd: -9 };

const tmp = mkdtempSync(join(tmpdir(), 'acoustic-'));
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
const kit = {};
mkdirSync(OUT, { recursive: true });
for (const [sound, picks] of Object.entries(PICKS)) {
  kit[sound] = [];
  for (const [i, [src, secs]] of picks.entries()) {
    const res = await fetch(BASE + src);
    if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
    const input = join(tmp, src.replace(/\//g, '_'));
    writeFileSync(input, Buffer.from(await res.arrayBuffer()));
    // Cut any silence before the hit, keep at most `secs`, fade out the last fifth.
    const shaped = join(tmp, `${sound}-${i}.wav`);
    const fade = secs * 0.2;
    ff(['-i', input, '-af', `silenceremove=start_periods=1:start_threshold=-60dB,atrim=0:${secs},afade=t=out:st=${secs - fade}:d=${fade}`, '-ar', '44100', '-ac', '2', shaped]);
    // Set the peak to the sound's level.
    const out = `${sound}-${i + 1}.wav`;
    const { stderr: log } = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', shaped, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    const peak = Number(log.match(/max_volume: (-?[\d.]+) dB/)?.[1] ?? 0);
    ff(['-i', shaped, '-af', `volume=${(LEVEL[sound] - peak).toFixed(2)}dB`, '-c:a', 'pcm_s16le', join(OUT, out)]);
    kit[sound].push(`AcousticKit/${out}`);
    console.log(`${sound} ${i + 1}: ${src} (peak ${peak} dB)`);
  }
}
writeFileSync('src/main/acoustic-kit.json', JSON.stringify({ source: `https://github.com/sfzinstruments/virtuosity_drums/tree/${COMMIT}`, licence: 'CC0-1.0', kits: { AcousticKit: kit } }, null, 2) + '\n');
rmSync(tmp, { recursive: true, force: true });

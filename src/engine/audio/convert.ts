// MP3, FLAC, OGG and AIFF files are decoded here and turned into WAV, so the rest of
// the app (pool, projects, collected samples, export) only deals with WAV.
import { AIFF_FILE, COMPRESSED_FILE } from '../../model/audioFiles';
import { readAiff } from './aiff';
import { encodeWav24 } from './exportWav';

const RATE = 48000;

/** WAV bytes for a sound file: WAV files as they are, other formats decoded and re-encoded. */
export async function toWav(name: string, bytes: Uint8Array): Promise<Uint8Array> {
  if (!COMPRESSED_FILE.test(name)) return bytes;
  if (AIFF_FILE.test(name)) {
    // Chromium has no AIFF decoder; the PCM is read directly.
    let pcm;
    try {
      pcm = readAiff(bytes);
    } catch (e) {
      throw new Error(`${name} could not be read as AIFF audio (${(e as Error).message}).`);
    }
    const buf = new AudioBuffer({ length: pcm.channels[0].length, numberOfChannels: pcm.channels.length, sampleRate: pcm.sampleRate });
    pcm.channels.forEach((ch, i) => buf.copyToChannel(ch, i));
    return encodeWav24(buf);
  }
  const ctx = new OfflineAudioContext(2, 1, RATE);
  let buf: AudioBuffer;
  try {
    // decodeAudioData detaches what it is given, so hand it a copy.
    buf = await ctx.decodeAudioData(bytes.slice().buffer);
  } catch {
    throw new Error(`${name} could not be read as ${name.split('.').pop()!.toUpperCase()} audio.`);
  }
  if (!buf.length) throw new Error(`${name} has no sound in it.`);
  return encodeWav24(buf);
}

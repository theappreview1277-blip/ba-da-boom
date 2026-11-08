// MP3, FLAC and OGG files are decoded here and turned into WAV, so the rest of
// the app (pool, projects, collected samples, export) only deals with WAV.
import { COMPRESSED_FILE } from '../../model/audioFiles';
import { encodeWav24 } from './exportWav';

const RATE = 48000;

/** WAV bytes for a sound file: WAV files as they are, other formats decoded and re-encoded. */
export async function toWav(name: string, bytes: Uint8Array): Promise<Uint8Array> {
  if (!COMPRESSED_FILE.test(name)) return bytes;
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

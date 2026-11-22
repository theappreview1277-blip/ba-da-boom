// AIFF and AIFF-C reading. Chromium can't decode AIFF itself, so the PCM data
// is read here (8, 16, 24 and 32-bit integers, big- or little-endian ('sowt'),
// and 32/64-bit floats) and handed back as float channels for converting to WAV.

export interface PcmAudio {
  sampleRate: number;
  channels: Float32Array<ArrayBuffer>[];
}

/** An 80-bit IEEE 754 extended float (the AIFF sample rate), as a number. */
function extended(view: DataView, at: number): number {
  const expSign = view.getUint16(at);
  const hi = view.getUint32(at + 2);
  const lo = view.getUint32(at + 6);
  const sign = expSign & 0x8000 ? -1 : 1;
  const exp = expSign & 0x7fff;
  if (exp === 0 && hi === 0 && lo === 0) return 0;
  return sign * (hi * 2 ** (exp - 16383 - 31) + lo * 2 ** (exp - 16383 - 63));
}

const fourcc = (view: DataView, at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));

/** The sound in an AIFF or AIFF-C file. Throws an Error with a plain message if it can't be read. */
export function readAiff(bytes: Uint8Array): PcmAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || fourcc(view, 0) !== 'FORM') throw new Error('not an AIFF file');
  const form = fourcc(view, 8);
  if (form !== 'AIFF' && form !== 'AIFC') throw new Error('not an AIFF file');
  const aifc = form === 'AIFC';

  let channels = 0;
  let frames = 0;
  let bits = 0;
  let rate = 0;
  let compression = 'NONE';
  let data = -1;
  let dataEnd = 0;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = fourcc(view, at);
    const size = view.getUint32(at + 4);
    const body = at + 8;
    if (id === 'COMM' && size >= 18 && body + 18 <= bytes.length) {
      channels = view.getUint16(body);
      frames = view.getUint32(body + 2);
      bits = view.getUint16(body + 6);
      rate = extended(view, body + 8);
      if (aifc && size >= 22 && body + 22 <= bytes.length) compression = fourcc(view, body + 18);
    } else if (id === 'SSND' && size >= 8 && body + 8 <= bytes.length) {
      const offset = view.getUint32(body);
      data = body + 8 + offset;
      dataEnd = Math.min(bytes.length, body + size);
    }
    at = body + size + (size & 1);
  }
  if (!channels || !rate || !bits) throw new Error('the file has no sound format');
  if (data < 0) throw new Error('the file has no sound in it');
  if (!Number.isFinite(rate) || rate < 3000 || rate > 768000) throw new Error('the sample rate is not one that can be played');
  if (channels > 32) throw new Error('the file has too many channels');

  const c = compression.toLowerCase();
  const float = c === 'fl32' || c === 'fl64';
  const little = c === 'sowt';
  if (!(c === 'none' || c === 'twos' || c === 'sowt' || c === 'raw ' || float)) throw new Error(`compressed AIFF (${compression.trim()}) is not supported`);
  const size = float ? (c === 'fl64' ? 8 : 4) : Math.ceil(bits / 8);
  if (!float && (size < 1 || size > 4)) throw new Error(`${bits}-bit AIFF is not supported`);
  const frameBytes = size * channels;
  const n = Math.min(frames, Math.floor((dataEnd - data) / frameBytes));
  if (n <= 0) throw new Error('the file has no sound in it');

  const out = Array.from({ length: channels }, () => new Float32Array(n));
  const scale = 2 ** (size * 8 - 1);
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const p = data + i * frameBytes + ch * size;
      let v: number;
      if (float) v = size === 8 ? view.getFloat64(p, false) : view.getFloat32(p, false);
      else if (size === 1) v = c === 'raw ' ? view.getUint8(p) - 128 : view.getInt8(p);
      else if (size === 2) v = view.getInt16(p, little);
      else if (size === 4) v = view.getInt32(p, little);
      else {
        const b0 = view.getUint8(p);
        const b1 = view.getUint8(p + 1);
        const b2 = view.getUint8(p + 2);
        const u = little ? b0 | (b1 << 8) | (b2 << 16) : (b0 << 16) | (b1 << 8) | b2;
        v = u & 0x800000 ? u - 0x1000000 : u;
      }
      out[ch][i] = float ? v : v / scale;
    }
  }
  return { sampleRate: Math.round(rate), channels: out };
}

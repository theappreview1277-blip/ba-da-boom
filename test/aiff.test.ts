import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readAiff } from '../src/engine/audio/aiff';

const FIX = 'test/fixtures/sounds';
const load = (f: string) => readAiff(new Uint8Array(readFileSync(`${FIX}/${f}`)));
const peak = (ch: Float32Array) => ch.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
/** Cycles a second, counted from upward zero crossings. */
const freq = (ch: Float32Array, rate: number) => {
  let n = 0;
  for (let i = 1; i < ch.length; i++) if (ch[i - 1] < 0 && ch[i] >= 0) n++;
  return (n * rate) / ch.length;
};

// The fixtures were written by ffmpeg (sine tones at 1/8 full scale); the
// reader's samples were checked against ffmpeg's own decoding and match exactly.
describe('AIFF reading', () => {
  it('reads 16-bit AIFF', () => {
    const a = load('tone.aiff');
    expect(a.sampleRate).toBe(44100);
    expect(a.channels.length).toBe(1);
    expect(a.channels[0].length).toBe(22050);
    expect(peak(a.channels[0])).toBeCloseTo(0.125, 2);
    expect(freq(a.channels[0], a.sampleRate)).toBeCloseTo(440, -1);
  });

  it('reads 24-bit stereo AIFF', () => {
    const a = load('other.aif');
    expect([a.sampleRate, a.channels.length, a.channels[0].length]).toEqual([48000, 2, 24000]);
    expect(Array.from(a.channels[1].slice(0, 100))).toEqual(Array.from(a.channels[0].slice(0, 100)));
    expect(freq(a.channels[0], a.sampleRate)).toBeCloseTo(660, -1);
  });

  it('reads AIFF-C: 32-bit float and little-endian (sowt)', () => {
    const f = load('float.aifc');
    expect([f.sampleRate, f.channels[0].length]).toEqual([22050, 5513]);
    expect(freq(f.channels[0], f.sampleRate)).toBeCloseTo(330, -1);
    const s = load('sowt.aifc');
    expect([s.sampleRate, s.channels[0].length]).toEqual([44100, 4410]);
    expect(peak(s.channels[0])).toBeCloseTo(0.125, 2);
  });

  it('refuses files that are not AIFF, or are cut short, with a plain reason', () => {
    expect(() => readAiff(new TextEncoder().encode('FORM'))).toThrow(/not an AIFF file/);
    expect(() => readAiff(new TextEncoder().encode('RIFF....WAVEfmt '))).toThrow(/not an AIFF file/);
    const whole = new Uint8Array(readFileSync(`${FIX}/tone.aiff`));
    expect(() => readAiff(whole.slice(0, 40))).toThrow();
    // A file cut off part way through the sound keeps what is there.
    expect(readAiff(whole.slice(0, 10000)).channels[0].length).toBeGreaterThan(4000);
  });
});

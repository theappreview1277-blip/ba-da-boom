// Synthesises the factory drum kit into resources/samples/*.wav.
// Every sound is generated from scratch by this script, so the kit contains no
// third-party recordings and is released as CC0 (see resources/samples/LICENSE.txt).
// Deterministic: a fixed-seed PRNG is used for noise, so rebuilding gives identical files.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'samples');
mkdirSync(out, { recursive: true });

let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const noise = () => rnd() * 2 - 1;

function render(seconds, fn) {
  const n = Math.round(seconds * SR);
  const buf = new Float32Array(n);
  const state = {};
  for (let i = 0; i < n; i++) buf[i] = fn(i / SR, state, i);
  return buf;
}

// One-pole filters, stateful per call site.
const lp = (s, key, x, cutoff) => {
  const a = Math.exp((-2 * Math.PI * cutoff) / SR);
  s[key] = (1 - a) * x + a * (s[key] ?? 0);
  return s[key];
};
const hp = (s, key, x, cutoff) => x - lp(s, key, x, cutoff);
// Simple 2-pole resonant band-pass (state variable filter).
const bp = (s, key, x, f, q) => {
  const k = 2 * Math.sin((Math.PI * f) / SR);
  const low = (s[key + 'l'] ?? 0) + k * (s[key + 'b'] ?? 0);
  const high = x - low - (s[key + 'b'] ?? 0) / q;
  const band = k * high + (s[key + 'b'] ?? 0);
  s[key + 'l'] = low;
  s[key + 'b'] = band;
  return band;
};
const env = (t, decay) => Math.exp(-t / decay);
const phaseOsc = (s, key, freq, shape = Math.sin) => {
  s[key] = (s[key] ?? 0) + (2 * Math.PI * freq) / SR;
  return shape(s[key]);
};
const square = (ph) => (Math.sin(ph) >= 0 ? 1 : -1);
const tanh = Math.tanh;

// Six detuned square waves, the classic metallic source for hats and cymbals.
const metal = (s, t, base = 1) =>
  [205.3, 304.4, 369.6, 522.7, 540, 800].reduce((acc, f, i) => acc + phaseOsc(s, 'm' + i, f * base, square), 0) / 6;

const sounds = {
  kick: render(0.6, (t, s) => {
    const f = 48 + 110 * Math.exp(-t / 0.035);
    const body = phaseOsc(s, 'o', f) * env(t, 0.22);
    const click = lp(s, 'c', noise(), 3000) * env(t, 0.004);
    return tanh(1.6 * (body + 0.6 * click)) * 0.9;
  }),
  'kick-sub': render(1.2, (t, s) => {
    const f = 42 + 60 * Math.exp(-t / 0.05);
    return tanh(1.3 * phaseOsc(s, 'o', f) * env(t, 0.45)) * 0.9;
  }),
  snare: render(0.45, (t, s) => {
    const tone = (phaseOsc(s, 'a', 185) * 0.6 + phaseOsc(s, 'b', 330) * 0.4) * env(t, 0.06);
    const n = hp(s, 'h', bp(s, 'n', noise(), 4500, 0.8), 900) * env(t, 0.16);
    return tanh(1.4 * (0.55 * tone + 0.9 * n)) * 0.85;
  }),
  clap: render(0.5, (t, s) => {
    // Several short bursts followed by a diffuse tail.
    const bursts = [0, 0.011, 0.022, 0.034];
    let e = 0;
    for (const b of bursts) if (t >= b) e = Math.max(e, env(t - b, 0.007));
    e = Math.max(e, t > 0.034 ? 0.55 * env(t - 0.034, 0.12) : 0);
    return tanh(1.5 * bp(s, 'n', noise(), 1200, 1.6) * e) * 0.85;
  }),
  rim: render(0.15, (t, s) => {
    const x = phaseOsc(s, 'a', 1700) * 0.6 + phaseOsc(s, 'b', 520) * 0.4;
    return (x * env(t, 0.018) + 0.3 * hp(s, 'h', noise(), 3000) * env(t, 0.004)) * 0.8;
  }),
  'hat-closed': render(0.18, (t, s) => hp(s, 'h', bp(s, 'b', metal(s, t), 9000, 1.2), 7000) * env(t, 0.03) * 1.4),
  'hat-open': render(0.9, (t, s) => hp(s, 'h', bp(s, 'b', metal(s, t), 9000, 1.2), 7000) * env(t, 0.28) * 1.2),
  'tom-low': render(0.7, (t, s) => tanh(1.2 * phaseOsc(s, 'o', 85 + 40 * env(t, 0.08)) * env(t, 0.28)) * 0.85),
  'tom-mid': render(0.6, (t, s) => tanh(1.2 * phaseOsc(s, 'o', 125 + 55 * env(t, 0.07)) * env(t, 0.24)) * 0.85),
  'tom-high': render(0.5, (t, s) => tanh(1.2 * phaseOsc(s, 'o', 180 + 70 * env(t, 0.06)) * env(t, 0.2)) * 0.85),
  cowbell: render(0.5, (t, s) => {
    const x = phaseOsc(s, 'a', 540, square) + phaseOsc(s, 'b', 800, square);
    return bp(s, 'f', x, 2640, 1.5) * (0.6 * env(t, 0.02) + 0.4 * env(t, 0.15)) * 0.7;
  }),
  clave: render(0.2, (t, s) => phaseOsc(s, 'o', 2500) * env(t, 0.025) * 0.8),
  shaker: render(0.2, (t, s) => {
    const e = Math.min(1, t / 0.015) * env(t, 0.05);
    return hp(s, 'h', noise(), 5000) * e * 0.6;
  }),
  crash: render(2.2, (t, s) => {
    const x = 0.6 * metal(s, t, 1.37) + 0.5 * noise();
    return hp(s, 'h', bp(s, 'b', x, 7000, 0.7), 4000) * env(t, 0.75) * 0.9;
  }),
  ride: render(1.8, (t, s) => {
    const bell = (phaseOsc(s, 'a', 3150) + phaseOsc(s, 'c', 4730)) * 0.12 * env(t, 0.4);
    const wash = hp(s, 'h', bp(s, 'b', metal(s, t, 1.9), 9500, 1), 6000) * env(t, 0.6) * 0.5;
    return bell + wash;
  }),
  conga: render(0.5, (t, s) => tanh(1.1 * phaseOsc(s, 'o', 220 + 60 * env(t, 0.015)) * env(t, 0.16)) * 0.85),
  'metro-hi': render(0.06, (t, s) => phaseOsc(s, 'o', 1760) * env(t, 0.012) * 0.8),
  'metro-lo': render(0.06, (t, s) => phaseOsc(s, 'o', 1320) * env(t, 0.012) * 0.8),
};

function wav16(samples) {
  // Normalise peaks to -1 dBFS and fade the last 5 ms to avoid clicks.
  let peak = 0;
  for (const x of samples) peak = Math.max(peak, Math.abs(x));
  const g = peak > 0 ? 0.891 / peak : 1;
  const fade = Math.round(0.005 * SR);
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const f = i > n - fade ? (n - i) / fade : 1;
    const v = Math.max(-1, Math.min(1, samples[i] * g * f));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

for (const [name, data] of Object.entries(sounds)) {
  writeFileSync(join(out, `${name}.wav`), wav16(data));
}
console.log(`wrote ${Object.keys(sounds).length} samples to ${out}`);

import { describe, expect, it } from 'vitest';
import { exportMidi, PPQ } from '../src/engine/strudel/midi';
import { newProject } from '../src/model/defaults';
import { setStep, songAdd } from '../src/model/ops';

/** Minimal SMF reader: tracks of absolute-tick events. */
function readMidi(b: Uint8Array) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const str = (o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));
  expect(str(0, 4)).toBe('MThd');
  const format = dv.getUint16(8);
  const ntracks = dv.getUint16(10);
  const ppq = dv.getUint16(12);
  let o = 14;
  const tracks: { name?: string; events: { tick: number; status: number; d1?: number; d2?: number; meta?: number; data?: Uint8Array }[] }[] = [];
  for (let t = 0; t < ntracks; t++) {
    expect(str(o, 4)).toBe('MTrk');
    const len = dv.getUint32(o + 4);
    let p = o + 8;
    const end = p + len;
    let tick = 0;
    const tr: (typeof tracks)[number] = { events: [] };
    const vl = () => {
      let n = 0;
      let c;
      do {
        c = b[p++];
        n = (n << 7) | (c & 0x7f);
      } while (c & 0x80);
      return n;
    };
    while (p < end) {
      tick += vl();
      const status = b[p++];
      if (status === 0xff) {
        const meta = b[p++];
        const l = vl();
        const data = b.slice(p, p + l);
        p += l;
        if (meta === 3) tr.name = new TextDecoder().decode(data);
        tr.events.push({ tick, status, meta, data });
      } else {
        tr.events.push({ tick, status, d1: b[p++], d2: b[p++] });
      }
    }
    expect(p).toBe(end);
    tracks.push(tr);
    o = end;
  }
  return { format, ppq, tracks };
}

describe('MIDI export', () => {
  it('writes the starter beat as GM drums on channel 10, one track per drum', () => {
    const p = newProject();
    const { bytes, notes } = exportMidi(p, p.patterns[0].id, 1);
    expect(notes).toBe(14);
    const m = readMidi(bytes);
    expect(m.format).toBe(1);
    expect(m.ppq).toBe(PPQ);
    expect(m.tracks.map((t) => t.name)).toEqual(['Untitled', 'Kick', 'Snare', 'Closed Hat']);
    const tempo = m.tracks[0].events.find((e) => e.meta === 0x51)!.data!;
    expect((tempo[0] << 16) | (tempo[1] << 8) | tempo[2]).toBe(500000); // 120 BPM
    const kickOns = m.tracks[1].events.filter((e) => e.status === 0x99);
    expect(kickOns.map((e) => [e.tick, e.d1, e.d2])).toEqual([0, 480, 960, 1440].map((t) => [t, 36, 121]));
    const snare = m.tracks[2].events.filter((e) => e.status === 0x99);
    expect(snare.map((e) => [e.tick, e.d1])).toEqual([[480, 38], [1440, 38]]);
    // Every note-on has a matching note-off.
    for (const t of m.tracks.slice(1)) expect(t.events.filter((e) => e.status === 0x89).length).toBe(t.events.filter((e) => e.status === 0x99).length);
  });

  it('includes ratchets and microtiming, and resolves probability with the seed', () => {
    let p = newProject();
    const id = p.patterns[1].id;
    p = setStep(p, id, 't3', 4, { on: true, ratchet: 2 });
    p = setStep(p, id, 't3', 8, { on: true, micro: 0.5 });
    for (let i = 0; i < 16; i++) p = setStep(p, id, 't1', i, { on: true, probability: 0.5 });
    const a = exportMidi(p, id, 4);
    const ticks = readMidi(a.bytes).tracks.find((t) => t.name === 'Snare')!.events.filter((e) => e.status === 0x99).map((e) => e.tick);
    expect(ticks.slice(0, 3)).toEqual([480, 480 + 60, 960 + 60]);
    expect(exportMidi(p, id, 4).bytes).toEqual(a.bytes);
    const kicks = readMidi(a.bytes).tracks.find((t) => t.name === 'Kick')!.events.filter((e) => e.status === 0x99).length;
    expect(kicks).toBeGreaterThan(16);
    expect(kicks).toBeLessThan(48);
  });

  it('exports the song', () => {
    let p = newProject();
    p = songAdd(songAdd(p, p.patterns[0].id), p.patterns[0].id);
    expect(exportMidi(p, 'song', 2).notes).toBe(28);
  });
});

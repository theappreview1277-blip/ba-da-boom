// Offline rendering of patterns to WAV.
//
// Uses the same Strudel pattern, superdough voices and master chain as live
// playback, rendered into an OfflineAudioContext. Probability is driven by
// Strudel's seeded random functions, which depend only on the project seed and
// the position in the pattern, so the exported file is the same every time and
// matches what plays from the start of live playback.

import { cpsFromBpm, patternFromModel } from '../strudel/fromModel';
import { songPattern } from '../strudel/song';
import type { Project } from '../../model/types';
import { buildMasterChain } from './master';
import {
  DEFAULT_MAX_POLYPHONY,
  getAudioContext,
  getSuperdoughAudioController,
  initAudio,
  setAudioContext,
  setMaxPolyphony,
  setSuperdoughAudioController,
  superdough,
} from './superdough';

export interface ExportOptions {
  /** The pattern to render, or 'song' for the whole arrangement (played once, no loop). */
  patternId: string | 'song';
  bars: number;
  sampleRate?: number;
  /** Extra time rendered after the last bar so reverb, delay and long samples ring out. */
  maxTailSeconds?: number;
  missingSamples?: Set<string>;
}

export interface ExportResult {
  buffer: AudioBuffer;
  /** Length of the musical part in seconds, before the tail. */
  musicalSeconds: number;
  events: number;
  peak: number;
}

/** Tail is trimmed once it stays below this level (about -80 dBFS). */
const SILENCE = 1e-4;

export async function renderPattern(project: Project, opts: ExportOptions): Promise<ExportResult> {
  const sampleRate = opts.sampleRate ?? 44100;
  const cps = cpsFromBpm(project.bpm);
  const musicalSeconds = opts.bars / cps;
  const tail = opts.maxTailSeconds ?? 6;
  // The metronome is never exported.
  const build = (id: string) => {
    const pattern = project.patterns.find((p) => p.id === id);
    if (!pattern) throw new Error('Pattern not found');
    return patternFromModel(project, pattern, { missingSamples: opts.missingSamples, metronome: false });
  };
  if (opts.patternId === 'song' && !project.song.length) throw new Error('The song is empty');
  const strudelPattern = opts.patternId === 'song' ? songPattern(project.song, false, build) : build(opts.patternId);

  const liveCtx = getAudioContext();
  const liveController = getSuperdoughAudioController();
  const offline = new OfflineAudioContext(2, Math.ceil((musicalSeconds + tail) * sampleRate), sampleRate);
  let events = 0;
  let rendered: AudioBuffer;
  // Freeze the live context while superdough's globals point at the offline one:
  // otherwise 'ended' callbacks of live voices that are still ringing would run
  // against the offline context and fail.
  const resumeLive = liveCtx instanceof AudioContext && liveCtx.state === 'running';
  if (resumeLive) await liveCtx.suspend();
  try {
    setAudioContext(offline);
    // A fresh controller of the same class superdough uses, bound to the offline context.
    const Controller = (liveController as any).constructor;
    setSuperdoughAudioController(new Controller(offline));
    // All voices are scheduled up front, so lift the polyphony limit that would
    // otherwise steal voices that only overlap on paper.
    await initAudio({ maxPolyphony: 1_000_000 });
    const master = buildMasterChain(offline, project.masterVolume);
    const out = getSuperdoughAudioController().output.destinationGain!;
    out.disconnect();
    out.connect(master.input);

    // Superdough must be called in onset order for choke groups (`cut`) to work.
    const haps = strudelPattern
      .queryArc(0, opts.bars)
      .filter((h) => h.hasOnset())
      .sort((a, b) => a.whole!.begin.valueOf() - b.whole!.begin.valueOf());
    for (const hap of haps) {
      const begin = hap.whole!.begin.valueOf();
      // Early microtiming on the very first step would fall before 0; it belongs to the previous loop.
      if (begin < 0) continue;
      await superdough({ ...hap.value }, begin / cps, hap.duration.valueOf() / cps, cps, begin);
      events++;
    }
    rendered = await offline.startRendering();
    // Superdough's cleanup callbacks for offline voices use the global context,
    // so let them run before switching back to the live one.
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    setAudioContext(liveCtx);
    setSuperdoughAudioController(liveController);
    setMaxPolyphony(DEFAULT_MAX_POLYPHONY);
    if (resumeLive) await (liveCtx as AudioContext).resume();
  }
  const trimmed = trimTail(rendered, Math.ceil(musicalSeconds * sampleRate));
  return { buffer: trimmed, musicalSeconds, events, peak: peakOf(trimmed) };
}

function peakOf(buf: AudioBuffer) {
  let p = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
  }
  return p;
}

/** Cut the tail after the last sample above SILENCE (never before the musical end), with a short fade. */
function trimTail(buf: AudioBuffer, musicalFrames: number): AudioBuffer {
  let last = musicalFrames;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = d.length - 1; i > last; i--) {
      if (Math.abs(d[i]) > SILENCE) {
        last = i;
        break;
      }
    }
  }
  const fade = Math.round(buf.sampleRate * 0.01);
  const length = Math.min(buf.length, last + fade);
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c).subarray(0, length);
    const dst = new Float32Array(src);
    if (length > musicalFrames) {
      for (let i = Math.max(musicalFrames, length - fade); i < length; i++) dst[i] *= (length - i) / fade;
    }
    out.copyToChannel(dst, c);
  }
  return out;
}

/** Encode as 24-bit PCM WAV. Values are clamped; the master chain's limiter keeps peaks below 0 dBFS in normal use. */
export function encodeWav24(buf: AudioBuffer): Uint8Array {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const bytes = 3;
  const data = new Uint8Array(44 + n * ch * bytes);
  const view = new DataView(data.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, 36 + n * ch * bytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, ch, true);
  view.setUint32(24, buf.sampleRate, true);
  view.setUint32(28, buf.sampleRate * ch * bytes, true);
  view.setUint16(32, ch * bytes, true);
  view.setUint16(34, 24, true);
  str(36, 'data');
  view.setUint32(40, n * ch * bytes, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      let x = Math.round(v < 0 ? v * 0x800000 : v * 0x7fffff);
      if (x < 0) x += 0x1000000;
      data[o++] = x & 0xff;
      data[o++] = (x >> 8) & 0xff;
      data[o++] = (x >> 16) & 0xff;
    }
  }
  return data;
}

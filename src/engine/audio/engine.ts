// Real-time playback: owns the AudioContext, sample loading, the Strudel
// scheduler (Cyclist), the master chain and meters.
//
// Scheduling never depends on the UI: the Cyclist queries the LiveSource
// pattern ahead of the audio clock on its own timer, and the UI only reads
// the playhead and meters on animation frames.

import { cpsFromBpm, METRONOME_ORBIT, patternFromModel, soundKey } from '../strudel/fromModel';
import { LiveSource, nextBar, nextStep } from '../strudel/liveSource';
import { songLength, songPattern, songPosition } from '../strudel/song';
import { silence } from '../strudel/strudel';
import { currentPattern } from '../../model/ops';
import type { Project, SampleRef } from '../../model/types';
import { METRONOME_SAMPLES } from '../../model/factory';
import {
  Cyclist,
  getAudioContext,
  getSuperdoughAudioController,
  getTrigger,
  initAudio,
  loadBuffer,
  samples,
  setAudioContext,
  superdough,
  webaudioOutput,
  type CyclistLike,
} from './superdough';
import { buildMasterChain, type MasterChain } from './master';

export type SampleStatus = 'loading' | 'ok' | 'missing';

/** Scheduler latency: time between querying a pattern and the sound starting. */
const LATENCY = 0.1;

export interface QueuedSwitch {
  patternId: string;
  atCycle: number;
}

export class AudioEngine {
  readonly ac: AudioContext;
  private scheduler!: CyclistLike;
  private live = new LiveSource(silence);
  private master!: MasterChain;
  private project: Project | null = null;
  private playingPatternId: string | null = null;
  private status = new Map<string, SampleStatus>();
  private urls = new Map<string, string>();
  private buffers = new Map<string, AudioBuffer>();
  private retries = 0;
  private stopping: Promise<void> | null = null;
  private trackAnalysers = new Map<number, AnalyserNode>();
  private meterBuf = new Float32Array(2048);
  private clipUntil = 0;
  queued: QueuedSwitch | null = null;
  /** Play the song arrangement instead of the current pattern (when the song is not empty). */
  songMode = false;
  /** While the song plays: the cycle it started at, and the cycle a pattern switch ends it (or Infinity). */
  private songSpan: { origin: number; until: number } | null = null;
  onSampleStatus?: (id: string, status: SampleStatus) => void;
  onError?: (message: string) => void;

  constructor(private resolveUrl: (ref: SampleRef) => string) {
    this.ac = new AudioContext({ latencyHint: 'interactive' });
  }

  async init() {
    setAudioContext(this.ac);
    await initAudio({});
    this.master = buildMasterChain(this.ac);
    this.patchOutput();
    this.scheduler = new Cyclist({
      onTrigger: getTrigger({ getTime: () => this.ac.currentTime, defaultOutput: webaudioOutput }),
      getTime: () => this.ac.currentTime,
      latency: LATENCY,
      onError: (e: unknown) => this.onError?.(String(e)),
    });
    await this.scheduler.setPattern(this.live.pattern, false);
  }

  /** Route superdough's output through our master chain. Needed again after a controller reset. */
  private patchOutput() {
    const out = getSuperdoughAudioController().output.destinationGain;
    if (!out) return;
    out.disconnect();
    out.connect(this.master.input);
  }

  get isPlaying() {
    return this.scheduler?.started ?? false;
  }

  /** The decoded sample, for drawing its waveform. */
  sampleBuffer(id: string): AudioBuffer | undefined {
    return this.status.get(id) === 'ok' ? this.buffers.get(id) : undefined;
  }

  sampleStatus(id: string): SampleStatus | undefined {
    return this.status.get(id);
  }

  /** Register and preload every sample the project references. Returns when all have settled. */
  async loadSamples(project: Project) {
    const jobs: Promise<void>[] = [];
    for (const ref of [...Object.values(project.samples), ...METRONOME_SAMPLES]) {
      const base = this.resolveUrl(ref);
      const known = this.urls.get(ref.id)?.split('?')[0] === base;
      const wasMissing = known && this.status.get(ref.id) === 'missing';
      if (known && !wasMissing) continue;
      // Strudel caches a failed load per URL, so a retry (the file was put back,
      // or the same WAV was imported again) needs a URL it hasn't seen.
      const url = wasMissing ? `${base}?retry=${++this.retries}` : base;
      this.urls.set(ref.id, url);
      this.setStatus(ref.id, 'loading');
      jobs.push(
        (async () => {
          try {
            await samples({ [soundKey(ref.id)]: [url] });
            const buf = await loadBuffer(url, this.ac);
            if (!buf || buf.length === 0) throw new Error('empty');
            this.buffers.set(ref.id, buf);
            this.setStatus(ref.id, 'ok');
          } catch {
            this.setStatus(ref.id, 'missing');
          }
        })(),
      );
    }
    await Promise.all(jobs);
    // Tracks whose samples just became available can now be heard.
    if (this.project) this.update(this.project);
  }

  private setStatus(id: string, s: SampleStatus) {
    this.status.set(id, s);
    this.onSampleStatus?.(id, s);
  }

  private missingSet(): Set<string> {
    const out = new Set<string>();
    for (const [id, s] of this.status) if (s !== 'ok') out.add(id);
    return out;
  }

  private buildSong(project: Project) {
    return songPattern(project.song, project.songLoop, (id) => this.build(project, id));
  }

  private songActiveAt(cycle: number | null) {
    return !!this.songSpan && cycle != null && cycle >= this.songSpan.origin && cycle < this.songSpan.until;
  }

  /** Where the song is at the audible cycle: entry index and pass, or null when the song isn't playing. */
  songState(): { index: number; pass: number; finished: boolean } | null {
    const c = this.audibleCycle();
    if (!this.project || !this.songActiveAt(c)) return null;
    const rel = c! - this.songSpan!.origin;
    const pos = songPosition(this.project.song, this.project.songLoop, rel);
    if (pos) return { index: pos.index, pass: pos.pass, finished: false };
    // Let the last hits ring for 2 s before calling the song finished.
    return { index: -1, pass: 0, finished: rel >= songLength(this.project.song) + 2 * cpsFromBpm(this.project.bpm) };
  }

  /** Switch between song and pattern playback. While playing, the change happens at the next bar. */
  setSongMode(on: boolean) {
    this.songMode = on;
    if (!this.project || !this.isPlaying) return;
    const playingSong = this.songActiveAt(this.scheduler.lastEnd);
    if (on && !playingSong && this.project.song.length) {
      this.settleQueued(this.scheduler.lastEnd);
      const at = nextBar(this.scheduler.lastEnd);
      this.queued = null;
      this.songSpan = { origin: at, until: Infinity };
      this.live.schedule(this.buildSong(this.project), at, at);
    } else if (!on && this.songSpan) {
      this.switchPattern(this.project.currentPatternId);
    }
  }

  private build(project: Project, patternId: string) {
    const pattern = project.patterns.find((p) => p.id === patternId) ?? currentPattern(project);
    return patternFromModel(project, pattern, { missingSamples: this.missingSet(), metronome: project.metronome });
  }

  /**
   * Apply an edited project. While playing, the change takes effect at the next
   * step boundary that has not been scheduled yet; the playing pattern keeps its phase.
   */
  update(project: Project) {
    this.project = project;
    this.master?.setVolume(project.masterVolume);
    if (!this.scheduler) return;
    this.scheduler.setCps(cpsFromBpm(project.bpm));
    if (!this.isPlaying) return;
    this.settleQueued(this.scheduler.lastEnd);
    const from = nextStep(this.scheduler.lastEnd);
    const span = this.songSpan;
    if (span && from < span.until) {
      // Song (or a song about to start): rebuild it; the segment keeps the song's origin.
      if (from >= span.origin) this.live.schedule(this.buildSong(project), from);
      else this.live.schedule(this.build(project, this.playingPatternId ?? project.currentPatternId), from);
      if (span.origin > from) this.live.schedule(this.buildSong(project), span.origin, span.origin);
      if (this.queued) this.live.schedule(this.build(project, this.queued.patternId), this.queued.atCycle, this.queued.atCycle);
      return;
    }
    const playing = this.playingPatternId ?? project.currentPatternId;
    this.live.schedule(this.build(project, playing), from);
    if (this.queued) this.live.schedule(this.build(project, this.queued.patternId), this.queued.atCycle, this.queued.atCycle);
  }

  /** Queue a pattern switch at the next bar line without restarting playback. */
  switchPattern(patternId: string) {
    if (!this.project) return;
    if (!this.isPlaying) {
      this.playingPatternId = patternId;
      return;
    }
    this.settleQueued(this.scheduler.lastEnd);
    const inSong = this.songActiveAt(this.scheduler.lastEnd) || (this.songSpan && this.scheduler.lastEnd < this.songSpan.origin);
    if (!inSong && patternId === this.playingPatternId && !this.queued) return;
    const at = nextBar(this.scheduler.lastEnd);
    // Leaving the song: it plays until the bar line, then the pattern takes over.
    if (this.songSpan) this.songSpan.until = Math.max(this.songSpan.origin, at);
    this.queued = { patternId, atCycle: at };
    this.live.schedule(this.build(this.project, patternId), at, at);
  }

  /** Once a queued switch has been reached (scheduled or heard), it becomes the playing pattern. */
  private settleQueued(cycle: number | null) {
    if (this.queued && cycle != null && cycle >= this.queued.atCycle) {
      this.playingPatternId = this.queued.patternId;
      this.queued = null;
    }
  }

  /** Pattern audible right now (accounts for queued switches that have been reached). */
  get audiblePatternId(): string | null {
    const c = this.audibleCycle();
    if (this.project && this.songActiveAt(c)) {
      return songPosition(this.project.song, this.project.songLoop, c! - this.songSpan!.origin)?.entry.patternId ?? null;
    }
    this.settleQueued(c);
    return this.isPlaying ? this.playingPatternId : null;
  }

  async play() {
    if (!this.project) return;
    if (this.stopping) await this.stopping;
    if (this.ac.state !== 'running') await this.ac.resume();
    if (this.isPlaying) return;
    this.playingPatternId = this.project.currentPatternId;
    this.queued = null;
    if (this.songMode && this.project.song.length) {
      this.songSpan = { origin: 0, until: Infinity };
      this.live.reset(this.buildSong(this.project));
    } else {
      this.songSpan = null;
      this.live.reset(this.build(this.project, this.playingPatternId));
    }
    this.scheduler.setCps(cpsFromBpm(this.project.bpm));
    await this.scheduler.start();
  }

  /**
   * Stop immediately: stop scheduling, fade the master out over 10 ms, then
   * discard the audio graph so already-scheduled hits and effect tails are silenced.
   */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.scheduler.stop();
    this.queued = null;
    this.songSpan = null;
    this.master.mute(this.ac.currentTime, 0.01);
    this.stopping = new Promise<void>((resolve) => {
      setTimeout(() => {
        getSuperdoughAudioController().reset();
        this.trackAnalysers.clear();
        this.patchOutput();
        this.master.unmute(this.ac.currentTime);
        this.stopping = null;
        resolve();
      }, 40);
    });
    return this.stopping;
  }

  /** The cycle (bar) currently reaching the speakers, or null when stopped. */
  audibleCycle(): number | null {
    const s = this.scheduler as any;
    if (!s?.started || s.seconds_at_cps_change == null) return null;
    const outLatency = (this.ac.outputLatency || 0) + (this.ac.baseLatency || 0);
    return (this.ac.currentTime - outLatency - s.latency - s.seconds_at_cps_change) * s.cps + s.num_cycles_at_cps_change;
  }

  /** Cycle position relative to the start of the audible pattern, for playheads. */
  patternCycle(): number | null {
    const c = this.audibleCycle();
    if (c == null || c < 0) return null;
    if (this.project && this.songActiveAt(c)) {
      const pos = songPosition(this.project.song, this.project.songLoop, c - this.songSpan!.origin);
      return pos ? c - this.songSpan!.origin - pos.start : null;
    }
    return c - this.live.originAt(c);
  }

  /** Play a sample once, now, with optional track sound controls. */
  async audition(sampleId: string, controls: Record<string, unknown> = {}) {
    if (this.status.get(sampleId) !== 'ok') return;
    if (this.ac.state !== 'running') await this.ac.resume();
    await superdough({ ...controls, s: soundKey(sampleId), orbit: METRONOME_ORBIT + 1 }, this.ac.currentTime + 0.01, 0.5);
  }

  /** Peak levels since the last call: master L/R (pre-limiter), clip latch, and per-track peaks. */
  readMeters(trackCount: number) {
    // While an export is rendering, superdough's globals point at the offline context.
    if (!this.master || getAudioContext() !== this.ac) {
      return { left: 0, right: 0, clip: false, limiting: false, tracks: new Array<number>(trackCount).fill(0) };
    }
    const m = this.master.readPeaks();
    const now = this.ac.currentTime;
    if (m.l >= 1 || m.r >= 1) this.clipUntil = now + 2;
    const controller = getSuperdoughAudioController();
    const tracks: number[] = [];
    for (let i = 0; i < trackCount; i++) {
      const orbit = i + 1;
      let an = this.trackAnalysers.get(orbit);
      const node = controller.nodes[orbit]?.output;
      if (!an && node) {
        an = this.ac.createAnalyser();
        an.fftSize = 2048;
        node.connect(an);
        this.trackAnalysers.set(orbit, an);
      }
      if (!an) {
        tracks.push(0);
        continue;
      }
      an.getFloatTimeDomainData(this.meterBuf);
      let p = 0;
      for (let k = 0; k < this.meterBuf.length; k++) p = Math.max(p, Math.abs(this.meterBuf[k]));
      tracks.push(p);
    }
    return { left: m.l, right: m.r, clip: now < this.clipUntil, limiting: m.reduction < -0.5, tracks };
  }

  resetClip() {
    this.clipUntil = 0;
  }
}

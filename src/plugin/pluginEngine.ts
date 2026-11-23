// The audio engine as the screen sees it inside the plugin. The plugin's C++ engine plays
// the beat in the host's time; this class sends it every change (as a play model) and
// reports back what the plugin is playing, through the same interface as AudioEngine, so
// the screen works unchanged. The web audio engine underneath is still used to decode
// sounds (for waveforms and checks) and to preview samples in the browser.

import { songPosition, songLength } from '../engine/strudel/song';
import { AudioEngine } from '../engine/audio/engine';
import { serializeProject } from '../model/serialize';
import type { MidiMap } from '../main/ipc';
import type { Project, SampleRef } from '../model/types';
import { call, canSend, onPluginState, onSendingAllowed, pluginState } from './bridge';
import { playModel } from './playModel';

export class PluginEngine extends AudioEngine {
  private current: Project | null = null;
  private sendTimer: number | null = null;
  /** The MIDI notes setting, which decides which note plays which pad. */
  midiMap: MidiMap = 'gm';
  /** Sounds the plugin could not load, from its last answer. */
  pluginMissing: string[] = [];

  constructor(resolveUrl: (ref: SampleRef) => string) {
    super(resolveUrl);
    onPluginState(() => this.updateQueued());
    // An empty plugin gets the screen's new project; a loaded one arrives as an edit anyway.
    onSendingAllowed((loaded) => !loaded && this.resend());
  }

  /** False when the web view has no working Web Audio: the plugin still plays, only previews in the screen are off. */
  webAudio = true;

  override async init() {
    try {
      await super.init();
    } catch (e) {
      this.webAudio = false;
      console.warn(`Web audio is not available in the plugin's screen: ${e}`);
    }
  }

  override async loadSamples(project: Project) {
    if (this.webAudio) await super.loadSamples(project);
  }

  override async previewSample(ref: SampleRef) {
    return this.webAudio ? super.previewSample(ref) : false;
  }

  override async audition(sampleId: string, controls: Record<string, unknown> = {}) {
    if (this.webAudio) await super.audition(sampleId, controls);
  }

  override async auditionSynth(controls: Record<string, unknown>) {
    if (this.webAudio) await super.auditionSynth(controls);
  }

  override update(project: Project) {
    // The browser engine never plays the beat, but keeps the project for its own lookups.
    if (this.webAudio) super.update(project);
    if (project === this.current) return;
    this.current = project;
    this.send();
  }

  /** Send the beat at most every 30 ms while editing (a drag changes it many times a second). */
  private send() {
    if (!canSend() || this.sendTimer != null) return;
    this.sendTimer = window.setTimeout(() => {
      this.sendTimer = null;
      const p = this.current;
      if (!p) return;
      const model = playModel(p, this.missingSamples(), this.midiMap);
      call<string[]>('setBeat', { model: JSON.stringify(model), project: serializeProject(p) })
        .then((missing) => (this.pluginMissing = missing ?? []))
        .catch((e) => this.onError?.(String(e?.message ?? e)));
    }, 30);
  }

  private missingSamples() {
    const out = new Set<string>();
    if (!this.current) return out;
    for (const t of this.current.tracks) if (t.sound.sampleId && this.sampleStatus(t.sound.sampleId) === 'missing') out.add(t.sound.sampleId);
    return out;
  }

  /** Sends the beat now (after the MIDI notes setting changed, say). */
  resend() {
    if (this.current) this.send();
  }

  override get isPlaying() {
    return pluginState().playing;
  }

  override get idle() {
    return !this.isPlaying && super.idle;
  }

  /** The host's transport plays the beat; Play on the screen previews it while the host is stopped. */
  override async play() {
    await call('transport', { preview: true });
  }

  override async stop() {
    await call('transport', { preview: false });
  }

  override setSongMode(on: boolean) {
    this.songMode = on;
    void call('song', { on });
  }

  /** The plugin plays the chosen pattern from the next bar line; it is chosen by the project's current pattern. */
  override switchPattern(_patternId: string) {}

  private get songPlaying() {
    return this.songMode && !!this.current?.song.length;
  }

  override get audiblePatternId(): string | null {
    const s = pluginState();
    if (!s.playing || !this.current) return null;
    return this.current.patterns[s.pattern]?.id ?? null;
  }

  /** A pattern chosen while another plays: shown as queued until the plugin reaches the bar line. */
  private updateQueued() {
    const id = this.audiblePatternId;
    const p = this.current;
    this.queued = !p || !id || this.songPlaying || id === p.currentPatternId ? null : { patternId: p.currentPatternId, atCycle: Math.ceil(pluginState().cycle) };
  }

  override songState() {
    const s = pluginState();
    const p = this.current;
    if (!s.playing || !p || !this.songPlaying) return null;
    const pos = songPosition(p.song, p.songLoop, s.cycle);
    if (pos) return { index: pos.index, pass: pos.pass, finished: false };
    return { index: -1, pass: 0, finished: s.cycle >= songLength(p.song) + 2 };
  }

  override audibleCycle(): number | null {
    const s = pluginState();
    return s.playing ? s.cycle : null;
  }

  override patternCycle(): number | null {
    const s = pluginState();
    const p = this.current;
    if (!s.playing || s.cycle < 0) return null;
    if (p && this.songPlaying) {
      const pos = songPosition(p.song, p.songLoop, s.cycle);
      return pos ? s.cycle - pos.start : null;
    }
    // Patterns line up with the host's bar 1.
    return s.cycle;
  }

  /** A pad: played by the plugin, so it goes to the host with everything else. */
  override async hit(controls: Record<string, unknown>, _sampleId: string | null, velocity: number) {
    this.lastSoundAt = performance.now();
    const track = typeof controls.orbit === 'number' ? controls.orbit - 1 : -1;
    if (track >= 0) await call('hit', { track, velocity });
  }

  override async setOutput(_deviceId: string) {}

  override readMeters(trackCount: number) {
    const s = pluginState();
    const tracks = Array.from({ length: trackCount }, (_, i) => s.tracks[i] ?? 0);
    return { left: s.left, right: s.right, clip: s.left >= 1 || s.right >= 1, limiting: false, tracks };
  }
}

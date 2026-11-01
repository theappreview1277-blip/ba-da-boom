// Master chain shared by live playback and export, so both sound the same:
//   superdough output -> master gain -> safety clipper -> destination
// Meters tap the signal after the master gain and before the clipper, so the
// clip light shows when the mix itself would clip.
//
// The safety stage is a static soft clipper (WaveShaper), not a compressor:
// Chromium's DynamicsCompressorNode adds a fixed ~6 ms look-ahead delay and
// audibly ducks the first transient after it starts, which would shift timing
// and change the first hit of every export.

export interface MasterChain {
  input: GainNode;
  setVolume(v: number): void;
  mute(at: number, fade: number): void;
  unmute(at: number): void;
  readPeaks(): { l: number; r: number; reduction: number };
}

export function buildMasterChain(ac: BaseAudioContext, volume = 0.8): MasterChain {
  const input = new GainNode(ac, { gain: 1, channelCount: 2, channelCountMode: 'explicit' });
  const gain = new GainNode(ac, { gain: volume });
  const fader = new GainNode(ac, { gain: 1 });
  const clipper = new WaveShaperNode(ac, { curve: softClipCurve(), oversample: 'none' });
  input.connect(gain).connect(fader).connect(clipper).connect(ac.destination);

  const split = new ChannelSplitterNode(ac, { numberOfOutputs: 2 });
  const al = new AnalyserNode(ac, { fftSize: 2048 });
  const ar = new AnalyserNode(ac, { fftSize: 2048 });
  gain.connect(split);
  split.connect(al, 0);
  split.connect(ar, 1);
  const buf = new Float32Array(2048);
  const peak = (a: AnalyserNode) => {
    a.getFloatTimeDomainData(buf);
    let p = 0;
    for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]));
    return p;
  };
  let vol = volume;

  return {
    input,
    setVolume(v) {
      if (v === vol) return;
      vol = v;
      gain.gain.setTargetAtTime(v, ac.currentTime, 0.01);
    },
    mute(at, fade) {
      fader.gain.cancelScheduledValues(at);
      fader.gain.setValueAtTime(fader.gain.value, at);
      fader.gain.linearRampToValueAtTime(0, at + fade);
    },
    unmute(at) {
      fader.gain.cancelScheduledValues(at);
      fader.gain.setValueAtTime(1, at);
    },
    readPeaks: () => {
      const l = peak(al);
      const r = peak(ar);
      return { l, r, reduction: Math.max(l, r) > KNEE ? -1 : 0 };
    },
  };
}

/** Linear below KNEE (-1 dBFS); above it, a smooth curve that approaches but never exceeds 1.0. */
const KNEE = 0.891;
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 4097;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // The WaveShaper maps input -1..1 onto the curve; inputs beyond that use the end values.
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= KNEE ? a : KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE));
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

#include "engine.h"
#include <algorithm>
#include <cmath>
#include <cstring>

namespace bdb {

namespace {
// superdough helpers.mjs getADSRValues
struct Adsr {
    double a, d, s, r;
};
Adsr adsrValues(double a, bool hasA, double d, bool hasD, double s, bool hasS, double r, bool hasR, const Adsr* defaults) {
    const double envmin = 0.001, releaseMin = 0.01, envmax = 1;
    if (!hasA && !hasD && !hasS && !hasR) return defaults ? *defaults : Adsr{envmin, envmin, envmax, releaseMin};
    const double sustain = hasS ? s : ((hasA && !hasD) || (!hasA && !hasD)) ? envmax : envmin;
    return {std::max(hasA ? a : 0, envmin), std::max(hasD ? d : 0, envmin), std::min(sustain, envmax), std::max(hasR ? r : 0, releaseMin)};
}

// superdough helpers.mjs getParamADSR
void paramAdsr(ParamTimeline& p, Adsr e, double min, double max, double begin, double end, bool exponential) {
    if (exponential) {
        min = min == 0 ? 0.001 : min;
        max = max == 0 ? 0.001 : max;
    }
    const double range = max - min;
    const double sustainVal = min + e.s * range;
    const double duration = end - begin;
    auto slope = [](double y1, double y2, double x1, double x2) { return x2 - x1 == 0 ? 0 : (y2 - y1) / (x2 - x1); };
    auto envAt = [&](double time) {
        double v = e.a > time ? time * slope(min, max, 0, e.a) + min : (time - e.a) * slope(max, sustainVal, 0, e.d) + max;
        if (exponential && v == 0) v = 0.001;
        return v;
    };
    auto ramp = [&](double v, double t) {
        if (exponential) p.exponentialRampToValueAtTime(v, t);
        else p.linearRampToValueAtTime(v, t);
    };
    p.reset(min);
    p.setValueAtTime(min, begin);
    if (e.a > duration) {
        ramp(envAt(duration), end);
    } else if (e.a + e.d > duration) {
        ramp(envAt(e.a), begin + e.a);
        ramp(envAt(duration), end);
    } else {
        ramp(envAt(e.a), begin + e.a);
        ramp(envAt(e.a + e.d), begin + e.a + e.d);
        p.setValueAtTime(sustainVal, end);
    }
    ramp(min, end + e.r);
}
// reverbGen.mjs applyGradualLowpass, then Chromium's ConvolverNode normalisation (reverb.cc
// CalculateNormalizationScale): a 15 kHz low-pass falling to 1 kHz over the decay time.
std::array<std::shared_ptr<const ConvolverIr>, 2> reverbIr(const std::vector<std::vector<float>>& noise, double sr) {
    const double decayTime = 2;
    std::array<std::vector<float>, 2> filtered;
    ParamTimeline freq(0);
    freq.setValueAtTime(std::min(15000.0, sr / 2), 0);
    freq.linearRampToValueAtTime(std::min(1000.0, sr / 2), decayTime);
    float power = 0;
    for (size_t ch = 0; ch < 2; ch++) {
        const auto& in = noise[std::min(ch, noise.size() - 1)];
        auto& out = filtered[ch];
        out.resize(in.size());
        Biquad lp;
        for (size_t i = 0; i < in.size(); i++) {
            lp.set(Biquad::Lowpass, static_cast<float>(freq.valueAt(static_cast<double>(i) / sr)), 0.0001, sr);
            out[i] = lp.process(in[i], 0);
        }
        for (float x : out) power += x * x;
    }
    const size_t length = filtered[0].size();
    power = std::sqrt(power / static_cast<float>(2 * length));
    if (!std::isfinite(power) || power < 0.000125f) power = 0.000125f;
    float scale = 1 / power;
    scale *= std::pow(10.0f, -58 * 0.05f);
    scale *= 44100.0f / static_cast<float>(sr);
    return {ConvolverIr::make(filtered[0].data(), length, scale), ConvolverIr::make(filtered[1].data(), length, scale)};
}

// worklets.mjs waveshapes.sawblep: a saw with polyBLEP smoothing at the jump.
double sawBlep(double phase, double dt) {
    dt = std::min(dt, 1 - dt);
    const double invdt = 1 / dt;
    double blep = 0;
    if (phase < dt) {
        const double p = phase * invdt;
        blep = 2 * p - p * p - 1;
    } else if (phase > 1 - dt) {
        const double p = (phase - 1) * invdt;
        blep = p * p + 2 * p + 1;
    }
    return 2 * phase - 1 - blep;
}
}  // namespace

void Engine::prepare(double sampleRate) {
    sr_ = sampleRate;
    // The synths' wave tables, built here and not on the audio thread.
    for (int i = 0; i < 4; i++) waves_[static_cast<size_t>(i)] = WaveTables::get(static_cast<WaveTables::Wave>(i), sr_);
    // noise.mjs getNoiseBuffer, 2 seconds each.
    const auto size = static_cast<size_t>(2 * sr_);
    auto fresh = [&](SampleData& d) {
        d.channels = 1;
        d.rate = sr_;
        d.data.assign(1, std::vector<float>(size));
        return d.data[0].data();
    };
    float* white = fresh(noise_[0]);
    for (size_t i = 0; i < size; i++) white[i] = static_cast<float>(random() * 2 - 1);
    float* pink = fresh(noise_[1]);
    double b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (size_t i = 0; i < size; i++) {
        const double w = random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        // the buffer is Float32, so the sum is rounded before the 0.11
        const auto sum = static_cast<float>(b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362);
        pink[i] = static_cast<float>(sum * 0.11);
        b6 = w * 0.115926;
    }
    float* brown = fresh(noise_[2]);
    float last = 0;
    for (size_t i = 0; i < size; i++) {
        const double w = random() * 2 - 1;
        brown[i] = last = static_cast<float>((last + 0.02 * w) / 1.02);
    }
    for (auto& cr : crackle_) {
        float* d = fresh(cr);
        const double probability = 0.02 * 0.01;  // density 0.02
        for (size_t i = 0; i < size; i++) d[i] = random() < probability ? static_cast<float>(random() * 2 - 1) : 0.0f;
    }
    // The tracks' delay lines (up to the DelayNode's 1 second) and reverbs (superdough's 2-second room).
    reverbIr_ = reverbIr(reverbGenNoise(), sr_);
    for (auto& b : buses_) {
        for (auto& line : b.line) line.assign(static_cast<size_t>(sr_) + 256, 0.f);
        for (size_t ch = 0; ch < 2; ch++) {
            b.reverb[ch].prepare(reverbIr_[ch]->length);
            b.reverb[ch].setIr(reverbIr_[ch]);
        }
    }
    for (size_t ch = 0; ch < 2; ch++) {
        sharedReverb_[ch].prepare(reverbIr_[ch]->length);
        sharedReverb_[ch].setIr(reverbIr_[ch]);
    }
    // synth.mjs makeSaturationCurve(2, sampleRate) for the synth kick's shaper.
    kickCurve_.resize(static_cast<size_t>(sr_));
    for (size_t i = 0; i < kickCurve_.size(); i++) kickCurve_[i] = static_cast<float>(std::tanh((i * 2.0 / kickCurve_.size() - 1) * 2));
    clear();
}

// reverbGen.mjs generateReverb: 3 seconds of stereo noise falling 60 dB over 2, faded in over 0.1.
std::vector<std::vector<float>> Engine::reverbGenNoise() {
    const double decayTime = 2, fadeIn = 0.1;
    const auto decayFrames = static_cast<double>(std::llround(decayTime * sr_));
    const auto frames = static_cast<size_t>(std::llround(decayTime * 1.5 * sr_));
    const auto fadeFrames = static_cast<size_t>(std::llround(fadeIn * sr_));
    const double decayBase = std::pow(1.0 / 1000, 1 / decayFrames);
    std::vector<std::vector<float>> noise(2, std::vector<float>(frames));
    for (auto& ch : noise) {
        for (size_t j = 0; j < frames; j++) ch[j] = static_cast<float>((random() * 2 - 1) * std::pow(decayBase, static_cast<double>(j)));
        for (size_t j = 0; j < fadeFrames; j++) ch[j] = static_cast<float>(ch[j] * (static_cast<double>(j) / static_cast<double>(fadeFrames)));
    }
    return noise;
}

double Engine::random(uint64_t& state) {
    uint64_t z = (state += 0x9e3779b97f4a7c15ull);
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ull;
    z = (z ^ (z >> 27)) * 0x94d049bb133111ebull;
    z ^= z >> 31;
    return static_cast<double>(z >> 11) * 0x1.0p-53;
}

void Engine::clear() {
    for (auto& v : voices_) v.active = false;
    cutGroups_.fill(nullptr);
    for (auto& b : buses_) {
        b.delayOn = b.reverbOn = false;
        b.changeAt = -1;
        for (auto& line : b.line) std::fill(line.begin(), line.end(), 0.f);
        for (auto& o : b.lastOut) o.fill(0);
        b.written = 0;
        for (size_t ch = 0; ch < 2; ch++) {
            if (b.ownIr) b.reverb[ch].setIr(reverbIr_[ch]);
            b.reverb[ch].reset();
        }
        b.ownIr = false;
        b.reverbRinging = 0;
    }
    for (auto& c : sharedReverb_) c.reset();
    sharedRinging_ = 0;
    reverbsMade_ = 0;
}

int Engine::activeVoices() const {
    int n = 0;
    for (auto& v : voices_) n += v.active;
    return n;
}

Voice* Engine::allocate(double time) {
    Voice* oldest = &voices_[0];
    for (auto& v : voices_) {
        if (!v.active) return &v;
        if (v.start < oldest->start) oldest = &v;
    }
    (void)time;
    return oldest;  // all busy: the oldest sound makes way
}

void Engine::trigger(const PlayModel& m, const SampleSet& set, const Hit& h, double t, double cps) {
    if (h.track < 0 || h.track >= static_cast<int>(m.tracks.size())) return;
    const Controls& c = m.tracks[h.track].controls;
    const double hapDuration = h.length / cps;
    int wave = -1;
    const SampleData* sample = nullptr;
    int source = Voice::Sample;
    if (c.synth) {
        static const char* const kWaves[] = {"sine", "square", "sawtooth", "triangle"};
        static const char* const kNoises[] = {"white", "pink", "brown"};
        for (int i = 0; i < 4; i++)
            if (c.s == kWaves[i]) wave = i, source = Voice::Wave;
        for (int i = 0; i < 3; i++)
            if (c.s == kNoises[i]) sample = noiseBuffer(set, i), source = Voice::Noise;
        if (c.s == "crackle") {
            const auto k = static_cast<size_t>(crackles_++);
            sample = k < set.crackles.size() ? set.crackles[k].get() : &crackle_[k % crackle_.size()];
            source = Voice::Noise;
        }
        if (c.s == "supersaw") source = Voice::Supersaw;
        if (c.s == "pulse") source = Voice::Pulse;
        if (c.s == "sbd") source = Voice::Kick;
        if (source == Voice::Sample) return;  // not a sound superdough knows
    } else {
        if (c.speed == 0) return;
        sample = set.find(c.s, c.speed < 0);
        if (!sample || sample->frames() == 0) return;
    }

    Adsr e{0, 0, 1, 0};
    Voice* v = allocate(t);
    for (auto& g : cutGroups_)
        if (g == v) g = nullptr;
    *v = Voice{};
    v->active = true;
    v->track = h.track;
    v->start = t;
    v->source = source;
    // helpers.mjs getFrequencyFromValue: the note, or C2 (29 for the synth kick).
    const double note = c.note != 0 ? c.note : source == Voice::Kick ? 29 : 36;
    const double frequency = 440 * std::pow(2.0, (note - 69) / 12);
    if (source == Voice::Kick) {
        // synth.mjs 'sbd': no ADSR; the triangle's own decay, a noise click and a 10 ms fade at the end.
        const double decay = c.decay >= 0 ? c.decay : 0.5, pdecay = 0.5, penv = 36, attackhold = 0.02;
        v->synth = true;
        v->oscTables = waves_[WaveTables::Triangle];
        v->oscFrequency = frequency;
        // Blink starts a source at the first frame at or after its time (audio_utilities TimeToSampleFrame).
        // The detune param is first worked out in the render quantum holding that frame, and events
        // already past by then move to the quantum's start (AudioParamTimeline's new-event clamping).
        v->kickStartFrame = static_cast<long long>(std::ceil(std::round(t * sr_ * 1024) / 1024));
        v->kickFirstQuantum = v->kickStartFrame - v->kickStartFrame % 128;
        v->kickDetune.reset(0);
        v->kickDetune.setValueAtTime(penv * 100, 0);
        v->kickDetune.setValueAtTime(penv * 100, std::max(t, v->kickFirstQuantum / sr_));
        v->kickDetune.exponentialRampToValueAtTime(0.001, t + pdecay);
        v->kickGain.reset(1);
        v->kickGain.setValueAtTime(1, t + attackhold);
        v->kickGain.exponentialRampToValueAtTime(0.001, t + attackhold + decay);
        v->kickNoiseGain.reset(1);
        v->kickNoiseGain.setValueAtTime(1.2, t);
        v->kickNoiseGain.exponentialRampToValueAtTime(0.001, t + 0.025);
        const double end = t + decay + 0.01;
        v->kickMix.reset(1);
        v->kickMix.setValueAtTime(1, end - 0.01);
        v->kickMix.linearRampToValueAtTime(0, end);
        v->sample = noiseBuffer(set, 2);
        v->env.reset(1);
        v->stopAt = end;
        v->gain = 1;
    } else if (c.synth) {
        // synth.mjs: the source into a gain, then a linear ADSR held for the hap's duration.
        static const Adsr kSynthDefaults{0.001, 0.05, 0.6, 0.01};
        e = adsrValues(c.attack, true, c.decay, c.decay >= 0, c.sustain, c.sustain >= 0, c.release, c.release >= 0, &kSynthDefaults);
        const double holdEnd = t + hapDuration;
        paramAdsr(v->env, e, 0, 1, t, holdEnd, false);
        v->stopAt = holdEnd + e.r + 0.01;
        v->synth = source != Voice::Noise;
        if (source == Voice::Wave) {
            v->oscTables = waves_[static_cast<size_t>(wave)];
            v->oscFrequency = frequency;
            v->gain = 0.3;
        } else if (source == Voice::Supersaw) {
            // 5 voices (unison), detune 0.18, spread 0.6; 0.3 / sqrt(voices) at the envelope's peak.
            // AudioParams are 32-bit floats; worklets.mjs getDetuner spreads the voices over freqspread semitones.
            const double f = static_cast<float>(frequency), spread = static_cast<float>(0.18);
            uint64_t fromStart = 0;
            if (set.supersawPhasesFromStart) {
                const auto begin = static_cast<float>(t);
                uint32_t bits;
                std::memcpy(&bits, &begin, 4);
                fromStart = 0x2545f4914f6cdd1dull ^ bits;
            }
            for (size_t n = 0; n < v->sawPhase.size(); n++) {
                v->sawPhase[n] = random(set.supersawPhasesFromStart ? fromStart : sawRandom_);
                const double freqVoice = f * std::pow(2.0, (n * (spread / 4) - spread * 0.5) / 12);
                const double dt = freqVoice * (1 / sr_);
                v->sawDt[n] = dt - std::floor(dt);
            }
            v->gain = 0.3 / std::sqrt(5.0);
        } else if (source == Voice::Pulse) {
            v->oscFrequency = static_cast<float>(frequency);
            v->pulseWidth = (1 - 0.5) * 3.14159265358979323846;  // pw 0.5
            v->gain = 1;
        } else {  // noise: a looped 2 s buffer into a 0.3 gain
            v->sample = sample;
            v->loop = true;
            v->rate = 1;
            v->gain = 0.3;
        }
    } else {
        v->sample = sample;
        v->rate = std::abs(c.speed);
        const double bufferDuration = sample->frames() / sr_;
        v->readOffset = c.begin * bufferDuration * sr_;
        const double playbackDuration = bufferDuration / v->rate;
        const double sliceDuration = (c.end - c.begin) * playbackDuration;
        const bool hasRelease = c.release >= 0;
        e = adsrValues(c.attack, true, c.decay, c.decay >= 0, c.sustain, c.sustain >= 0, c.release, hasRelease, nullptr);
        const double duration = hasRelease ? hapDuration : sliceDuration;
        const double holdEnd = t + duration;
        paramAdsr(v->env, e, 0, 1, t, holdEnd, false);
        v->stopAt = holdEnd + e.r + 0.01;
        v->gain = 1;
    }
    v->cutGain.reset(1);

    if (c.cut >= 0 && c.cut < static_cast<int>(cutGroups_.size())) {
        Voice* prev = cutGroups_[c.cut];
        if (prev && prev->active) {
            prev->cutGain.setValueAtTime(1, t);
            prev->cutGain.linearRampToValueAtTime(0, t + 0.01);
        }
        cutGroups_[c.cut] = v;
    }

    v->gain *= c.gain * h.velocity;
    v->pan = 2 * c.pan - 1;
    const int stages = c.ftype == "24db" ? 2 : 1;
    const double end = t + hapDuration;
    if (c.cutoff >= 0) {
        v->lpCount = stages;
        v->lpQ = c.resonance >= 0 ? c.resonance : 1;
        v->lpFreq.reset(c.cutoff);
        if (c.hasLpEnv) {
            const Adsr fd{0.005, 0.14, 0, 0.1};
            const Adsr fe = adsrValues(c.lpattack, true, c.lpdecay, true, c.lpsustain, true, 0, false, &fd);
            const double env = c.lpenv, envAbs = std::abs(env);
            double lo = std::clamp(c.cutoff, 0.0, 20000.0), hi = std::clamp(std::pow(2.0, envAbs) * c.cutoff, 0.0, 20000.0);
            if (env < 0) std::swap(lo, hi);
            paramAdsr(v->lpFreq, fe, lo, hi, t, end, true);
        }
        for (int i = 0; i < stages; i++) v->lp[i].set(Biquad::Lowpass, c.cutoff, v->lpQ, sr_);
    }
    if (c.hcutoff >= 0) {
        v->hpCount = stages;
        v->hpQ = c.hresonance >= 0 ? c.hresonance : 1;
        v->hpFreq = c.hcutoff;
        for (int i = 0; i < stages; i++) v->hp[i].set(Biquad::Highpass, c.hcutoff, v->hpQ, sr_);
    }
    if (c.bandf >= 0) {
        v->bpCount = stages;
        v->bpQ = c.bandq >= 0 ? c.bandq : 1;
        v->bpFreq = c.bandf;
        for (int i = 0; i < stages; i++) v->bp[i].set(Biquad::Bandpass, c.bandf, v->bpQ, sr_);
    }
    // superdough.mjs: endWithRelease = end + release (0.01 when not set).
    setEffects(*v, c, h, t, end + (c.release >= 0 ? c.release : 0.01), cps);
    setSends(*v, c, set, t);
}

// superdough.mjs: the orbit's delay and reverb sends, made with the first sound that uses them.
void Engine::setSends(Voice& v, const Controls& c, const SampleSet& set, double t) {
    if (v.track < 0 || v.track >= kMaxTracks) return;
    OrbitBus& b = buses_[static_cast<size_t>(v.track)];
    if (c.delay > 0 && c.delaytime > 0 && c.delayfeedback > 0) {
        // Orbit.getDelay: feedback clamped to 0.98; the DelayNode's delayTime to its 1-second maximum.
        const auto time = static_cast<float>(std::min(c.delaytime, 1.0));
        const auto feedback = static_cast<float>(std::clamp(c.delayfeedback, 0.0, 0.98));
        if (!b.delayOn) {
            b.delayOn = true;
            b.delayTime = time;
            b.feedback = feedback;
            b.changeAt = -1;
        } else if (time != b.delayTime || feedback != b.feedback) {
            b.nextDelayTime = time;
            b.nextFeedback = feedback;
            b.changeAt = t;
        }
        v.delaySend = static_cast<float>(c.delay);
    }
    if (c.room > 0) {
        if (!b.reverbOn) {
            b.reverbOn = true;
            const auto k = static_cast<size_t>(reverbsMade_++);
            if (k < set.reverbNoise.size() && set.reverbNoise[k]) {
                const auto ir = reverbIr(set.reverbNoise[k]->data, sr_);
                for (size_t ch = 0; ch < 2; ch++) b.reverb[ch].setIr(ir[ch]);
                b.ownIr = true;
            }
        }
        v.roomSend = static_cast<float>(c.room);
    }
}

namespace {
struct Formant {
    const char* letter;
    double freqs[5], gains[5], qs[5];
};
// vowel.mjs vowelFormant.
const Formant kFormants[] = {
    {"a", {660, 1120, 2750, 3000, 3350}, {1, 0.5012, 0.0708, 0.0631, 0.0126}, {80, 90, 120, 130, 140}},
    {"e", {440, 1800, 2700, 3000, 3300}, {1, 0.1995, 0.1259, 0.1, 0.1}, {70, 80, 100, 120, 120}},
    {"i", {270, 1850, 2900, 3350, 3590}, {1, 0.0631, 0.0631, 0.0158, 0.0158}, {40, 90, 100, 120, 120}},
    {"o", {430, 820, 2700, 3000, 3300}, {1, 0.3162, 0.0501, 0.0794, 0.01995}, {40, 80, 100, 120, 120}},
    {"u", {370, 630, 2750, 3000, 3400}, {1, 0.1, 0.0708, 0.0316, 0.01995}, {40, 60, 100, 120, 120}},
};
}  // namespace

void Engine::setEffects(Voice& v, const Controls& c, const Hit& h, double t, double endWithRelease, double cps) {
    for (const auto& f : kFormants) {
        if (c.vowel != f.letter) continue;
        v.vowelCount = 5;
        for (int i = 0; i < 5; i++) {
            v.vowel[i].set(Biquad::Bandpass, f.freqs[i], f.qs[i], sr_);
            v.vowelGain[i] = f.gains[i] * 8;  // VowelNode's makeup gain is 8
        }
    }
    if (c.coarse >= 0) v.coarse = std::max(1.0, c.coarse);
    if (c.crush >= 0) v.crush = std::max(1.0, c.crush);
    if (c.shape >= 0) {
        const double sh = c.shape < 1 ? c.shape : 1.0 - 4e-10;
        v.shape = (2.0 * sh) / (1.0 - sh);
    }
    if (c.distort >= 0) v.distort = std::expm1(c.distort);
    if (c.tremolo >= 0) {
        // GainNode at max(1 - depth, 0), plus an LFO: a ramp (skew 1) raised to 1.5, between 0 and 1.
        v.tremolo = true;
        v.tremoloBase = std::max(1 - c.tremolodepth, 0.0);
        Lfo& l = v.tremoloLfo;
        l.skew = 1, l.frequency = c.tremolo, l.depth = c.tremolodepth, l.time = h.cycle / cps, l.dcoffset = 0;
        l.min = 0, l.max = 1, l.curve = 1.5, l.begin = t, l.end = endWithRelease;
    }
    if (c.phaserrate >= 0 && c.phaserdepth > 0) {
        // superdough getPhaser: one notch at 1000 + 282 Hz swept by +-2000 cents.
        v.phaser = true;
        v.phaserFreq = 1000 + 282;
        v.phaserQ = 2 - std::min(std::max(c.phaserdepth * 2, 0.0), 1.9);
        Lfo& l = v.phaserLfo;
        l.frequency = c.phaserrate, l.depth = 2000 * 2, l.begin = t, l.end = endWithRelease, l.time = t;
        l.dcoffset = -0.5, l.min = -0.5 * l.depth, l.max = -0.5 * l.depth + l.depth;
        v.phaserNotch.set(Biquad::Notch, v.phaserFreq, v.phaserQ, sr_);
    }
}

void Engine::effects(Voice& v, long long frame, bool mono, float& l, float& r) {
    if (v.vowelCount) {
        // Five band-passes side by side, each with its own gain.
        double sl = 0, sr = 0;
        for (int i = 0; i < 5; i++) {
            sl += v.vowel[i].process(l, 0) * v.vowelGain[i];
            if (!mono) sr += v.vowel[i].process(r, 1) * v.vowelGain[i];
        }
        l = static_cast<float>(sl);
        if (!mono) r = static_cast<float>(sr);
    }
    if (v.coarse > 0) {
        // coarse-processor: within each 128-frame quantum, keep frames n % coarse == 0 and hold them.
        const double n = static_cast<double>(frame % 128);
        if (std::fmod(n, v.coarse) == 0) {
            v.holdL = l, v.holdR = r;
        } else {
            l = v.holdL, r = v.holdR;
        }
    }
    if (v.crush > 0) {
        const double x = std::pow(2.0, v.crush - 1);
        l = static_cast<float>(std::floor(l * x + 0.5) / x);
        r = static_cast<float>(std::floor(r * x + 0.5) / x);
    }
    if (v.shape >= 0) {
        const double k = v.shape;
        l = static_cast<float>(((1 + k) * l) / (1 + k * std::abs(l)));
        r = static_cast<float>(((1 + k) * r) / (1 + k * std::abs(r)));
    }
    if (v.distort >= 0) {
        l = static_cast<float>(scurve(l, v.distort));
        r = static_cast<float>(scurve(r, v.distort));
    }
    if (v.tremolo) {
        const double g = v.tremoloBase + v.tremoloLfo.next(frame, sr_);
        l = static_cast<float>(l * g);
        r = static_cast<float>(r * g);
    }
}

void Engine::stopAll(double time) {
    for (auto& v : voices_) {
        if (!v.active) continue;
        const double now = v.cutGain.valueAt(time);
        v.cutGain.reset(now);
        v.cutGain.setValueAtTime(now, time);
        v.cutGain.linearRampToValueAtTime(0, time + 0.01);
        v.stopAt = std::min(v.stopAt, time + 0.011);
    }
}

void Engine::render(double time, int frames, float* mixL, float* mixR, float* const* tracks, double masterVolume, bool clip) {
    for (int f = 0; f < frames; f++) {
        mixL[f] = mixR[f] = 0;
        if (tracks)
            for (int i = 0; i < 2 * kMaxTracks; i++)
                if (tracks[i]) tracks[i][f] = 0;
    }
    for (int offset = 0; offset < frames; offset += kChunk)
        renderChunk(time, std::min(kChunk, frames - offset), offset, frames, mixL, mixR, tracks);
    trackGainDone_ = trackGain_;
    for (int f = 0; f < frames; f++) {
        const float l = static_cast<float>(mixL[f] * masterVolume), r = static_cast<float>(mixR[f] * masterVolume);
        mixL[f] = clip ? clipper_.process(l) : l;
        mixR[f] = clip ? clipper_.process(r) : r;
    }
}

// Frames [offset, offset + frames) of a render of `total` frames from `time`.
void Engine::renderChunk(double time, int frames, int offset, int total, float* mixL, float* mixR, float* const* tracks) {
    for (int t = 0; t < kMaxTracks; t++)
        if (buses_[t].delayOn || buses_[t].reverbOn)
            for (auto& ch : sends_[t]) std::fill(ch.begin(), ch.begin() + frames, 0.f);
    sentReverb_.fill(false);
    mixL += offset;
    mixR += offset;
    for (auto& v : voices_) {
        if (!v.active) continue;
        const SampleData* sp = v.sample;
        // Oscillators and the kick are mono; the supersaw and pulse worklets give two channels.
        const bool mono = v.source == Voice::Supersaw || v.source == Voice::Pulse ? false
                          : v.source == Voice::Wave || v.source == Voice::Kick ? true
                                                                                : sp->channels == 1;
        const auto n = sp ? static_cast<double>(sp->frames()) : 0.0;
        const float* c0 = sp ? sp->data[0].data() : nullptr;
        const float* c1 = mono || !sp ? c0 : sp->data[1].data();
        const int ti = v.track < kMaxTracks ? v.track : 0;
        const double gStep = (trackGain_[ti] - trackGainDone_[ti]) / total, g0 = trackGainDone_[ti] + gStep * offset;
        float* tl = tracks && v.track < kMaxTracks && tracks[2 * v.track] ? tracks[2 * v.track] + offset : nullptr;
        float* tr = tracks && v.track < kMaxTracks && tracks[2 * v.track + 1] ? tracks[2 * v.track + 1] + offset : nullptr;
        auto& send = sends_[static_cast<size_t>(ti)];
        const bool sends = v.track < kMaxTracks && (v.delaySend > 0 || v.roomSend > 0);
        if (sends && v.roomSend > 0) sentReverb_[static_cast<size_t>(ti)] = true;
        for (int f = 0; f < frames; f++) {
            const double tt = time + (offset + f) / sr_;
            if (tt < v.start) continue;
            if (tt >= v.stopAt) {
                v.active = false;
                break;
            }
            const double g = v.env.valueAt(tt) * v.cutGain.valueAt(tt) * v.gain;
            float l, r;
            const long long frame = std::llround(tt * sr_);
            // Worklets run whole 128-frame render quanta; currentTime is the quantum's start.
            const long long quantumFrame = frame % 128;
            const double quantumTime = static_cast<double>(frame - quantumFrame) / sr_;
            const bool quantumOn = quantumTime > v.start && quantumTime < v.stopAt;
            if (v.source == Voice::Wave) {
                if (!v.oscStarted) {
                    v.oscStarted = true;
                    v.osc.start(v.oscTables, v.oscFrequency, sr_, (tt - v.start) * sr_);
                }
                l = r = static_cast<float>(v.osc.next() * g);
            } else if (v.source == Voice::Supersaw) {
                float sl = 0, sr = 0;
                if (quantumOn) {
                    const double pan = static_cast<float>(0.6) * 0.5 + 0.5;
                    double gl = std::sqrt(1 - pan), gr = std::sqrt(pan);
                    for (size_t k = 0; k < v.sawPhase.size(); k++) {
                        double& ph = v.sawPhase[k];
                        const double s = sawBlep(ph, v.sawDt[k]);
                        sl = static_cast<float>(sl + s * gl);
                        sr = static_cast<float>(sr + s * gr);
                        ph += v.sawDt[k];
                        if (ph >= 1) ph -= 1;
                        std::swap(gl, gr);
                    }
                }
                l = static_cast<float>(sl * g);
                r = static_cast<float>(sr * g);
            } else if (v.source == Voice::Pulse) {
                float o = 0;
                if (quantumOn) {
                    constexpr double pi = 3.14159265358979323846;
                    if (quantumFrame == 0) v.pulseEnv = 1;  // `let env = 1` in every process() call
                    const double freq = v.oscFrequency;
                    v.dphif += 0.1 * (freq * 2 * pi * (1 / sr_) - v.dphif);
                    v.pulseEnv *= 0.9998;
                    v.envf += 0.1 * (v.pulseEnv - v.envf);
                    const double b = std::max(0.0, 2.3 * (1 - 0.0001 * freq));
                    v.phi += v.dphif;
                    if (v.phi >= pi) v.phi -= 2 * pi;
                    const double out0 = std::cos(v.phi + b * v.y0);
                    v.y0 = 0.5 * (out0 + v.y0);
                    const double out1 = std::cos(v.phi + b * v.y1 + v.pulseWidth);
                    v.y1 = 0.5 * (out1 + v.y1);
                    o = static_cast<float>(0.15 * (out0 - out1) * v.envf);
                }
                l = r = static_cast<float>(o * g);
            } else if (v.source == Voice::Kick) {
                // The triangle's detune is a-rate. Blink's a-rate path starts at phase 0 (no sub-frame offset),
                // picks the tables per frame from the increment, and in the first quantum reads the increments
                // from the quantum's start, not from the start frame.
                const long long q = v.kickFirstQuantum;
                const long long at = frame < q + 128 ? q + (frame - v.kickStartFrame) : frame;
                if (!v.oscStarted) {
                    v.oscStarted = true;
                    v.osc.start(v.oscTables, 0, sr_, 0);
                }
                const auto detune = static_cast<float>(v.kickDetune.valueAt(at / sr_));
                const float scale = static_cast<float>(v.oscTables->rateScale()) * static_cast<float>(v.oscFrequency);
                v.osc.setIncrement(std::exp2(detune * (1.0f / 1200)) * scale);
                const float x = v.osc.next();
                // WaveShaperNode, no oversampling: the curve read with linear interpolation.
                const double cl = static_cast<double>(kickCurve_.size() - 1);
                const double ci = cl * 0.5 * (x + 1.0);
                float shaped;
                if (ci < 0) shaped = kickCurve_.front();
                else if (ci >= cl) shaped = kickCurve_.back();
                else {
                    const auto k = static_cast<size_t>(ci);
                    const auto fr = static_cast<float>(ci - k);
                    shaped = (1 - fr) * kickCurve_[k] + fr * kickCurve_[k + 1];
                }
                const auto tone = static_cast<float>(shaped * v.kickGain.valueAt(tt));
                double idx = (tt - v.start) * sr_;
                idx -= std::floor(idx / n) * n;
                const auto i0 = static_cast<size_t>(idx);
                const double fr = idx - i0;
                const size_t i1 = i0 + 1 < sp->frames() ? i0 + 1 : 0;
                const auto noise = static_cast<float>(((1 - fr) * c0[i0] + fr * c0[i1]) * v.kickNoiseGain.valueAt(tt));
                l = r = static_cast<float>((tone + noise) * v.kickMix.valueAt(tt) * g);
            } else {
                double idx = v.readOffset + (tt - v.start) * sr_ * v.rate;
                if (v.loop) idx -= std::floor(idx / n) * n;
                if (idx >= n) {
                    v.active = false;
                    break;
                }
                const auto i0 = static_cast<size_t>(idx);
                const double fr = idx - i0;
                const size_t i1 = i0 + 1 < sp->frames() ? i0 + 1 : v.loop ? 0 : i0;
                l = static_cast<float>(((1 - fr) * c0[i0] + fr * (i1 == i0 ? 0 : c0[i1])) * g);
                r = mono ? l : static_cast<float>(((1 - fr) * c1[i0] + fr * (i1 == i0 ? 0 : c1[i1])) * g);
            }
            if (v.lpCount) {
                if (v.lpFreq.automated()) {
                    const double fq = v.lpFreq.valueAt(tt);
                    for (int k = 0; k < v.lpCount; k++) v.lp[k].set(Biquad::Lowpass, fq, v.lpQ, sr_);
                }
                for (int k = 0; k < v.lpCount; k++) {
                    l = v.lp[k].process(l, 0);
                    if (!mono) r = v.lp[k].process(r, 1);
                }
            }
            for (int k = 0; k < v.hpCount; k++) {
                l = v.hp[k].process(l, 0);
                if (!mono) r = v.hp[k].process(r, 1);
            }
            for (int k = 0; k < v.bpCount; k++) {
                l = v.bp[k].process(l, 0);
                if (!mono) r = v.bp[k].process(r, 1);
            }
            effects(v, frame, mono, l, r);
            float ol, orr;
            stereoPan(l, mono ? l : r, mono, v.pan, ol, orr);
            if (v.phaser) {
                const double cents = v.phaserLfo.next(frame, sr_);
                v.phaserNotch.set(Biquad::Notch, v.phaserFreq * std::pow(2.0, cents / 1200), v.phaserQ, sr_);
                ol = v.phaserNotch.process(ol, 0);
                orr = v.phaserNotch.process(orr, 1);
            }
            const auto tg = static_cast<float>(g0 + gStep * f);
            ol *= tg;
            orr *= tg;
            if (sends) {
                send[0][f] += ol * v.delaySend;
                send[1][f] += orr * v.delaySend;
                send[2][f] += ol * v.roomSend;
                send[3][f] += orr * v.roomSend;
            }
            peaks_[ti] = std::max(peaks_[ti], std::max(std::abs(ol), std::abs(orr)));
            mixL[f] += ol;
            mixR[f] += orr;
            if (tl) tl[f] += ol;
            if (tr) tr[f] += orr;
        }
    }

    // The tracks' delay and reverb returns, into the track's output and the mix.
    bool shared = false;
    for (int t = 0; t < kMaxTracks; t++) {
        OrbitBus& b = buses_[static_cast<size_t>(t)];
        if (!b.delayOn && !b.reverbOn) continue;
        const auto& send = sends_[static_cast<size_t>(t)];
        float* tl = tracks ? tracks[2 * t] : nullptr;
        float* tr = tracks ? tracks[2 * t + 1] : nullptr;
        const long long ringFrames = static_cast<long long>(reverbIr_[0]->length) + ConvolverIr::kBlock2;
        const bool sent = sentReverb_[static_cast<size_t>(t)];
        bool ownReverb = false;
        if (b.reverbOn && (b.ownIr || tl || tr)) {
            b.reverbRinging = sent ? ringFrames : b.reverbRinging - frames;
            ownReverb = b.reverbRinging > 0;
        } else if (b.reverbOn && sent) {
            if (!shared) {
                for (auto& ch : sharedSend_) std::fill(ch.begin(), ch.begin() + frames, 0.f);
                shared = true;
            }
            for (int f = 0; f < frames; f++) {
                sharedSend_[0][static_cast<size_t>(f)] += send[2][static_cast<size_t>(f)];
                sharedSend_[1][static_cast<size_t>(f)] += send[3][static_cast<size_t>(f)];
            }
        }
        if (!b.delayOn && !ownReverb) continue;
        for (int f = 0; f < frames; f++) {
            float l = 0, r = 0;
            if (b.delayOn) {
                const double tt = time + (offset + f) / sr_;
                if (b.changeAt >= 0 && tt >= b.changeAt) {
                    b.delayTime = b.nextDelayTime;
                    b.feedback = b.nextFeedback;
                    b.changeAt = -1;
                }
                const size_t size = b.line[0].size();
                const auto w = static_cast<size_t>(b.written % static_cast<long long>(size));
                const auto q = static_cast<size_t>(b.written % 128);
                // AudioDelayDSPKernel: read delayTime * sampleRate frames back, linearly interpolated.
                double rp = static_cast<double>(w) + static_cast<double>(size) - static_cast<double>(b.delayTime) * sr_;
                if (rp >= static_cast<double>(size)) rp -= static_cast<double>(size);
                const auto i1 = static_cast<size_t>(rp);
                const size_t i2 = i1 + 1 < size ? i1 + 1 : 0;
                const double fr = rp - static_cast<double>(i1);
                float y[2];
                for (int ch = 0; ch < 2; ch++) {
                    auto& line = b.line[static_cast<size_t>(ch)];
                    line[w] = send[static_cast<size_t>(ch)][f] + b.feedback * b.lastOut[static_cast<size_t>(ch)][q];
                    y[ch] = static_cast<float>((1 - fr) * line[i1] + fr * line[i2]);
                    b.lastOut[static_cast<size_t>(ch)][q] = y[ch];
                }
                b.written++;
                l += y[0];
                r += y[1];
            }
            if (ownReverb) {
                l += b.reverb[0].process(send[2][f]);
                r += b.reverb[1].process(send[3][f]);
            }
            peaks_[static_cast<size_t>(t)] = std::max(peaks_[static_cast<size_t>(t)], std::max(std::abs(l), std::abs(r)));
            mixL[f] += l;
            mixR[f] += r;
            if (tl) tl[offset + f] += l;
            if (tr) tr[offset + f] += r;
        }
    }
    // The shared reverb runs on while it rings, so a track that stops sending still decays.
    sharedRinging_ = shared ? static_cast<long long>(reverbIr_[0]->length) + ConvolverIr::kBlock2 : sharedRinging_ - frames;
    if (sharedRinging_ > 0) {
        if (!shared)
            for (auto& ch : sharedSend_) std::fill(ch.begin(), ch.begin() + frames, 0.f);
        for (int f = 0; f < frames; f++) {
            mixL[f] += sharedReverb_[0].process(sharedSend_[0][static_cast<size_t>(f)]);
            mixR[f] += sharedReverb_[1].process(sharedSend_[1][static_cast<size_t>(f)]);
        }
    }
}

Rendered renderOffline(const PlayModel& m, const SampleSet& s, int pattern, int bars, double sampleRate, double tailSeconds) {
    const double cps = m.bpm / 240;
    std::vector<Hit> hits;
    if (pattern < 0) {
        PlayModel once = m;
        once.songLoop = false;
        songHits(once, 0, bars, hits);
    } else {
        patternHits(m, pattern, 0, 0, bars, hits);
    }
    std::stable_sort(hits.begin(), hits.end(), [](const Hit& a, const Hit& b) { return a.cycle < b.cycle; });
    auto engine = std::make_unique<Engine>();
    engine->prepare(sampleRate);
    const double musical = bars / cps;
    const auto total = static_cast<size_t>(std::ceil((musical + tailSeconds) * sampleRate));
    Rendered out;
    out.left.assign(total, 0);
    out.right.assign(total, 0);
    size_t next = 0;
    const int block = 128;
    for (size_t pos = 0; pos < total; pos += block) {
        const int n = static_cast<int>(std::min<size_t>(block, total - pos));
        const double t0 = pos / sampleRate, t1 = (pos + n) / sampleRate;
        while (next < hits.size() && hits[next].cycle / cps < t1) {
            if (hits[next].cycle >= 0) {
                engine->trigger(m, s, hits[next], hits[next].cycle / cps, cps);
                out.events++;
            }
            next++;
        }
        engine->render(t0, n, out.left.data() + pos, out.right.data() + pos, nullptr, m.masterVolume);
    }
    // exportWav.ts trimTail: cut after the last sound above -80 dBFS, with a 10 ms fade.
    const auto musicalFrames = static_cast<size_t>(std::ceil(musical * sampleRate));
    size_t last = musicalFrames;
    for (auto* ch : {&out.left, &out.right})
        for (size_t i = ch->size(); i-- > last;)
            if (std::abs((*ch)[i]) > 1e-4f) {
                last = i;
                break;
            }
    const auto fade = static_cast<size_t>(std::lround(sampleRate * 0.01));
    const size_t length = std::min(total, last + fade);
    for (auto* ch : {&out.left, &out.right}) {
        ch->resize(length);
        if (length > musicalFrames)
            for (size_t i = std::max(musicalFrames, length - fade); i < length; i++) (*ch)[i] *= static_cast<float>(length - i) / fade;
    }
    return out;
}

}  // namespace bdb

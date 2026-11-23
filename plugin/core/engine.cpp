#include "engine.h"
#include <algorithm>
#include <cmath>

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
}  // namespace

void Engine::prepare(double sampleRate) {
    sr_ = sampleRate;
    // The synths' wave tables, built here and not on the audio thread.
    for (int i = 0; i < 4; i++) waves_[static_cast<size_t>(i)] = WaveTables::get(static_cast<WaveTables::Wave>(i), sr_);
    clear();
}

void Engine::clear() {
    for (auto& v : voices_) v.active = false;
    cutGroups_.fill(nullptr);
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
    if (c.synth) {
        static const char* const kWaves[] = {"sine", "square", "sawtooth", "triangle"};
        for (int i = 0; i < 4; i++)
            if (c.s == kWaves[i]) wave = i;
        if (wave < 0) return;  // the other synths: not in the plugin yet
    } else {
        if (c.speed == 0) return;
        sample = set.find(c.s, c.speed < 0);
        if (!sample || sample->frames() == 0) return;
    }

    Voice* v = allocate(t);
    for (auto& g : cutGroups_)
        if (g == v) g = nullptr;
    *v = Voice{};
    v->active = true;
    v->track = h.track;
    v->start = t;
    Adsr e;
    if (c.synth) {
        // synth.mjs: an oscillator into a 0.3 gain, then a linear ADSR held for the hap's duration.
        static const Adsr kSynthDefaults{0.001, 0.05, 0.6, 0.01};
        v->synth = true;
        v->oscTables = waves_[static_cast<size_t>(wave)];
        const double note = c.note != 0 ? c.note : 36;
        v->oscFrequency = 440 * std::pow(2.0, (note - 69) / 12);
        e = adsrValues(c.attack, true, c.decay, c.decay >= 0, c.sustain, c.sustain >= 0, c.release, c.release >= 0, &kSynthDefaults);
        const double holdEnd = t + hapDuration;
        paramAdsr(v->env, e, 0, 1, t, holdEnd, false);
        v->stopAt = holdEnd + e.r + 0.01;
        v->gain = 0.3;
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
    setEffects(*v, c, h, t, end + e.r, cps);
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
    for (auto& v : voices_) {
        if (!v.active) continue;
        const SampleData* sp = v.sample;
        const bool mono = v.synth || sp->channels == 1;
        const auto n = v.synth ? 0.0 : static_cast<double>(sp->frames());
        const float* c0 = v.synth ? nullptr : sp->data[0].data();
        const float* c1 = v.synth || mono ? c0 : sp->data[1].data();
        const int ti = v.track < kMaxTracks ? v.track : 0;
        const double g0 = trackGainDone_[ti], gStep = (trackGain_[ti] - g0) / frames;
        float* tl = tracks && v.track < kMaxTracks ? tracks[2 * v.track] : nullptr;
        float* tr = tracks && v.track < kMaxTracks ? tracks[2 * v.track + 1] : nullptr;
        for (int f = 0; f < frames; f++) {
            const double tt = time + f / sr_;
            if (tt < v.start) continue;
            if (tt >= v.stopAt) {
                v.active = false;
                break;
            }
            const double g = v.env.valueAt(tt) * v.cutGain.valueAt(tt) * v.gain;
            float l, r;
            if (v.synth) {
                if (!v.oscStarted) {
                    v.oscStarted = true;
                    v.osc.start(v.oscTables, v.oscFrequency, sr_, (tt - v.start) * sr_);
                }
                l = r = static_cast<float>(v.osc.next() * g);
            } else {
                const double idx = v.readOffset + (tt - v.start) * sr_ * v.rate;
                if (idx >= n) {
                    v.active = false;
                    break;
                }
                const auto i0 = static_cast<size_t>(idx);
                const double fr = idx - i0;
                const size_t i1 = i0 + 1 < sp->frames() ? i0 + 1 : i0;
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
            const long long frame = std::llround(tt * sr_);
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
            peaks_[ti] = std::max(peaks_[ti], std::max(std::abs(ol), std::abs(orr)));
            mixL[f] += ol;
            mixR[f] += orr;
            if (tl) tl[f] += ol;
            if (tr) tr[f] += orr;
        }
    }
    trackGainDone_ = trackGain_;
    for (int f = 0; f < frames; f++) {
        const float l = static_cast<float>(mixL[f] * masterVolume), r = static_cast<float>(mixR[f] * masterVolume);
        mixL[f] = clip ? clipper_.process(l) : l;
        mixR[f] = clip ? clipper_.process(r) : r;
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

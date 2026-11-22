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
    if (c.synth) return;  // synth tracks: not in the plugin yet
    if (c.speed == 0) return;
    const SampleData* sample = set.find(c.s, c.speed < 0);
    if (!sample || sample->frames() == 0) return;
    const double hapDuration = h.length / cps;

    Voice* v = allocate(t);
    for (auto& g : cutGroups_)
        if (g == v) g = nullptr;
    *v = Voice{};
    v->active = true;
    v->track = h.track;
    v->sample = sample;
    v->start = t;
    v->rate = std::abs(c.speed);
    const double bufferDuration = sample->frames() / sr_;
    v->readOffset = c.begin * bufferDuration * sr_;
    const double playbackDuration = bufferDuration / v->rate;
    const double sliceDuration = (c.end - c.begin) * playbackDuration;
    const bool hasRelease = c.release >= 0;
    const Adsr e = adsrValues(c.attack, true, c.decay, c.decay >= 0, c.sustain, c.sustain >= 0, c.release, hasRelease, nullptr);
    const double duration = hasRelease ? hapDuration : sliceDuration;
    const double holdEnd = t + duration;
    paramAdsr(v->env, e, 0, 1, t, holdEnd, false);
    v->stopAt = holdEnd + e.r + 0.01;
    v->cutGain.reset(1);

    if (c.cut >= 0 && c.cut < static_cast<int>(cutGroups_.size())) {
        Voice* prev = cutGroups_[c.cut];
        if (prev && prev->active) {
            prev->cutGain.setValueAtTime(1, t);
            prev->cutGain.linearRampToValueAtTime(0, t + 0.01);
        }
        cutGroups_[c.cut] = v;
    }

    v->gain = c.gain * h.velocity;
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
        const SampleData& s = *v.sample;
        const bool mono = s.channels == 1;
        const auto n = static_cast<double>(s.frames());
        const float* c0 = s.data[0].data();
        const float* c1 = mono ? c0 : s.data[1].data();
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
            const double idx = v.readOffset + (tt - v.start) * sr_ * v.rate;
            if (idx >= n) {
                v.active = false;
                break;
            }
            const auto i0 = static_cast<size_t>(idx);
            const double fr = idx - i0;
            const size_t i1 = i0 + 1 < s.frames() ? i0 + 1 : i0;
            const double g = v.env.valueAt(tt) * v.cutGain.valueAt(tt) * v.gain;
            float l = static_cast<float>(((1 - fr) * c0[i0] + fr * (i1 == i0 ? 0 : c0[i1])) * g);
            float r = mono ? l : static_cast<float>(((1 - fr) * c1[i0] + fr * (i1 == i0 ? 0 : c1[i1])) * g);
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
            float ol, orr;
            stereoPan(l, mono ? l : r, mono, v.pan, ol, orr);
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

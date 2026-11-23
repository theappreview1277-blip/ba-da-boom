// The plugin's sound engine: plays the play model's hits with superdough's sampler voice
// (sampler.mjs onTriggerSample + superdough.mjs's gain, filter and pan stages), into a
// stereo mix and one stereo output per track.
#pragma once
#include <array>
#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <vector>
#include "dsp.h"
#include "oscillator.h"
#include "play_model.h"
#include "sample.h"
#include "scheduler.h"

namespace bdb {

/** Every sound the model uses, decoded at the engine's sample rate, by superdough sound name. */
struct SampleSet {
    std::map<std::string, std::shared_ptr<const SampleData>> sounds;
    /** Reversed copies, for tracks that play backwards. */
    std::map<std::string, std::shared_ptr<const SampleData>> reversedSounds;
    /** White, pink and brown noise buffers to use instead of the engine's own (the tests pass the app's). */
    std::array<std::shared_ptr<const SampleData>, 3> noise;
    /** Crackle buffers for the crackle sounds in turn, instead of the engine's own (the tests pass the app's). */
    std::vector<std::shared_ptr<const SampleData>> crackles;
    /**
     * Tests: start each supersaw's voices at phases drawn from its start time (as a 32-bit float, the
     * worklet's `begin`), the way the tests seed the app's worklet, instead of from the running sequence.
     */
    bool supersawPhasesFromStart = false;
    const SampleData* find(const std::string& key, bool reverse) const {
        auto& m = reverse ? reversedSounds : sounds;
        auto it = m.find(key);
        return it == m.end() ? nullptr : it->second.get();
    }
};

constexpr int kMaxTracks = 16;
constexpr int kMaxVoices = 256;

struct Voice {
    bool active = false;
    int track = 0;
    const SampleData* sample = nullptr;
    enum Source { Sample = 0, Wave, Supersaw, Pulse, Noise, Kick };
    int source = Sample;     // Noise plays a looped engine-made buffer through the sample path
    bool synth = false;      // made by the engine instead of read from a sample (Wave, Supersaw, Pulse, Kick)
    bool loop = false;       // the sample loops (noise)
    bool oscStarted = false;
    Oscillator osc;
    std::shared_ptr<const WaveTables> oscTables;
    double oscFrequency = 0;
    // supersaw (worklets.mjs SuperSawOscillatorProcessor, 5 voices)
    std::array<double, 5> sawPhase{}, sawDt{};
    // pulse (worklets.mjs PulseOscillatorProcessor)
    double phi = -3.14159265358979323846, y0 = 0, y1 = 0, dphif = 0, envf = 0, pulseEnv = 1, pulseWidth = 0;
    // sbd (synth.mjs): a pitch-swept triangle through a tanh shaper, plus a brown noise click
    ParamTimeline kickDetune, kickGain, kickNoiseGain, kickMix;
    long long kickStartFrame = 0, kickFirstQuantum = 0;
    double kickNoiseRead = 0;
    double start = 0;        // seconds (engine clock) when the sound starts
    double readOffset = 0;   // frames into the sample at `start`
    double rate = 1;         // playback rate
    double stopAt = 0;       // bufferSource.stop() time
    double gain = 1;         // gain * velocity
    double pan = 0;          // -1..1
    ParamTimeline env;       // envelope gain
    ParamTimeline cutGain{1};  // the cut-group gain (fades out when another sound in the group starts)
    // Filters: up to two each (24 dB = two in series).
    int lpCount = 0, hpCount = 0, bpCount = 0;
    std::array<Biquad, 2> lp, hp, bp;
    double lpQ = 1, hpQ = 1, bpQ = 1, hpFreq = 0, bpFreq = 0;
    ParamTimeline lpFreq;
    // Effects, in superdough's order after the filters.
    int vowelCount = 0;
    std::array<Biquad, 5> vowel;
    std::array<double, 5> vowelGain{};
    double coarse = 0;               // > 0: hold every coarse-th frame of each render quantum
    float holdL = 0, holdR = 0;
    double crush = 0;                // > 0: bits
    double shape = -1;               // >= 0: shape amount, already mapped
    double distort = -1;             // >= 0: k for the s-curve
    bool tremolo = false;
    double tremoloBase = 0;          // the AM gain without the LFO
    Lfo tremoloLfo;
    bool phaser = false;
    Biquad phaserNotch;
    double phaserFreq = 0, phaserQ = 1;
    Lfo phaserLfo;
};

class Engine {
public:
    void prepare(double sampleRate);
    double sampleRate() const { return sr_; }

    /** Starts the sound of one hit at `time` seconds on the engine clock. Call in onset order. */
    void trigger(const PlayModel& m, const SampleSet& s, const Hit& h, double time, double cps);
    /**
     * Renders `frames` frames starting at engine time `time` into `mix` (stereo) and, when given,
     * `tracks` (kMaxTracks stereo pairs, may be null). Outputs are overwritten.
     * Track outputs are before the master volume and clipper; the mix is after.
     */
    void render(double time, int frames, float* mixL, float* mixR, float* const* tracks, double masterVolume, bool clip = true);
    /** An extra gain for a track's sound (the plugin's volume and mute), reached smoothly over the next render. */
    void setTrackGain(int track, double gain) {
        if (track >= 0 && track < kMaxTracks) trackGain_[track] = gain;
    }
    /** Each track's peak level since the last call (whether or not the host takes its own output), then reset. */
    float takePeak(int track) {
        const float p = peaks_[track];
        peaks_[track] = 0;
        return p;
    }
    /** Fades every sound out quickly (transport stop). */
    void stopAll(double time);
    void clear();
    int activeVoices() const;

private:
    Voice* allocate(double time);
    void setEffects(Voice& v, const Controls& c, const Hit& h, double t, double endWithRelease, double cps);
    void effects(Voice& v, long long frame, bool mono, float& l, float& r);
    double sr_ = 44100;
    std::array<Voice, kMaxVoices> voices_{};
    std::array<Voice*, 64> cutGroups_{};  // superdough's cutGroups, by choke group number
    SoftClipper clipper_;
    std::array<std::shared_ptr<const WaveTables>, 4> waves_;  // sine, square, sawtooth, triangle at sr_
    // noise.mjs getNoiseBuffer: 2 s of white, pink and brown noise, and a few crackles (made fresh for
    // every sound in superdough; here taken in turn).
    std::array<SampleData, 3> noise_;
    std::array<SampleData, 4> crackle_;
    long long crackles_ = 0;  // crackle sounds started so far
    std::vector<float> kickCurve_;  // synth.mjs makeSaturationCurve(2, sampleRate)
    uint64_t random_ = 0x9e3779b97f4a7c15ull;     // for the noise buffers
    uint64_t sawRandom_ = 0x2545f4914f6cdd1dull;  // for the supersaw voices' phases
    static double random(uint64_t& state);         // 0..1, like Math.random (splitmix64)
    double random() { return random(random_); }
    const SampleData* noiseBuffer(const SampleSet& set, int type) const {
        const auto& given = set.noise[static_cast<size_t>(type)];
        return given && given->frames() ? given.get() : &noise_[static_cast<size_t>(type)];
    }
    std::array<float, kMaxTracks> peaks_{};
    std::array<double, kMaxTracks> trackGain_ = filled(1.0), trackGainDone_ = filled(1.0);
    static std::array<double, kMaxTracks> filled(double v) {
        std::array<double, kMaxTracks> a;
        a.fill(v);
        return a;
    }
};

/** What an offline render (export) gives back. */
struct Rendered {
    std::vector<float> left, right;
    int events = 0;
};

/**
 * exportWav.ts renderPattern: the pattern (or the song, once) for `bars` bars plus up to
 * `tailSeconds`, master volume and clipper applied. pattern < 0 means the song.
 */
Rendered renderOffline(const PlayModel& m, const SampleSet& s, int pattern, int bars, double sampleRate, double tailSeconds = 6);

}  // namespace bdb

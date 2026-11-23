// The plugin's sound engine: plays the play model's hits with superdough's sampler voice
// (sampler.mjs onTriggerSample + superdough.mjs's gain, filter and pan stages), into a
// stereo mix and one stereo output per track.
#pragma once
#include <array>
#include <map>
#include <memory>
#include <string>
#include <vector>
#include "dsp.h"
#include "play_model.h"
#include "sample.h"
#include "scheduler.h"

namespace bdb {

/** Every sound the model uses, decoded at the engine's sample rate, by superdough sound name. */
struct SampleSet {
    std::map<std::string, std::shared_ptr<const SampleData>> sounds;
    /** Reversed copies, for tracks that play backwards. */
    std::map<std::string, std::shared_ptr<const SampleData>> reversedSounds;
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
    double sr_ = 44100;
    std::array<Voice, kMaxVoices> voices_{};
    std::array<Voice*, 64> cutGroups_{};  // superdough's cutGroups, by choke group number
    SoftClipper clipper_;
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

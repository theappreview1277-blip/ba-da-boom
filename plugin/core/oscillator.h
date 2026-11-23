// Chromium's OscillatorNode for the stock waves (sine, square, sawtooth, triangle): band-limited
// wave tables, one per third of an octave, made the way Blink's PeriodicWave makes them, and read
// with the same interpolation. superdough's basic synths are these oscillators.
#pragma once
#include <array>
#include <memory>
#include <vector>

namespace bdb {

class WaveTables {
public:
    enum Wave { Sine = 0, Square, Sawtooth, Triangle };
    /** Tables for one wave at one sample rate (shared, built once). */
    static std::shared_ptr<const WaveTables> get(Wave wave, double sampleRate);

    int size() const { return size_; }
    double rateScale() const { return rateScale_; }
    /** Blink's PeriodicWave::WaveDataForFundamentalFrequency. */
    void forFrequency(float frequency, const float*& lower, const float*& higher, float& tableFactor) const;

    WaveTables(Wave wave, double sampleRate);

private:
    int size_ = 4096;
    int ranges_ = 36;
    float lowest_ = 0;
    double rateScale_ = 0;
    std::vector<std::vector<float>> tables_;
};

/** One oscillator voice: Blink's OscillatorHandler at a fixed frequency (k-rate). */
class Oscillator {
public:
    /** `lateFrames`: how far (0..1 frame) the first frame is after the start time; the phase starts that far in. */
    void start(std::shared_ptr<const WaveTables> tables, double frequency, double sampleRate, double lateFrames = 0);
    float next();

private:
    std::shared_ptr<const WaveTables> tables_;
    const float* lower_ = nullptr;
    const float* higher_ = nullptr;
    float tableFactor_ = 0;
    float incr_ = 0;
    double index_ = 0;
};

}  // namespace bdb

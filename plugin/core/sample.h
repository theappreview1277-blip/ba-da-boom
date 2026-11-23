// Decoded sample data, and reading WAV files (the app stores every imported sound as WAV).
#pragma once
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace bdb {

struct SampleData {
    int channels = 1;
    double rate = 44100;
    /** One vector per channel, all the same length. */
    std::vector<std::vector<float>> data;
    size_t frames() const { return data.empty() ? 0 : data[0].size(); }
};

/** Decodes PCM (8, 16, 24, 32 bit) or 32/64-bit float WAV. Throws std::runtime_error. */
SampleData decodeWav(const uint8_t* bytes, size_t size);

/**
 * Converts to another sample rate (as decodeAudioData does when the file's rate differs
 * from the audio context's). Windowed-sinc, so it is clean enough for drums.
 */
SampleData resample(const SampleData& in, double rate);

/** Reverses every channel (superdough's reverseBuffer, for negative speed). */
SampleData reversed(const SampleData& in);

}  // namespace bdb

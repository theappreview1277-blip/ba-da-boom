#include "sample.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>

namespace bdb {

namespace {
uint32_t u32(const uint8_t* p) { return p[0] | (p[1] << 8) | (p[2] << 16) | (static_cast<uint32_t>(p[3]) << 24); }
uint16_t u16(const uint8_t* p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }
}  // namespace

SampleData decodeWav(const uint8_t* b, size_t n) {
    if (n < 12 || std::memcmp(b, "RIFF", 4) != 0 || std::memcmp(b + 8, "WAVE", 4) != 0) throw std::runtime_error("not a WAV file");
    int format = 0, channels = 0, bits = 0;
    uint32_t rate = 0;
    const uint8_t* data = nullptr;
    size_t dataSize = 0;
    size_t pos = 12;
    while (pos + 8 <= n) {
        const uint8_t* id = b + pos;
        size_t size = u32(b + pos + 4);
        const uint8_t* body = b + pos + 8;
        size_t avail = std::min(size, n - pos - 8);
        if (!std::memcmp(id, "fmt ", 4) && avail >= 16) {
            format = u16(body);
            channels = u16(body + 2);
            rate = u32(body + 4);
            bits = u16(body + 14);
            if (format == 0xFFFE && avail >= 26) format = u16(body + 24);  // WAVE_FORMAT_EXTENSIBLE: the sub-format
        } else if (!std::memcmp(id, "data", 4)) {
            data = body;
            dataSize = avail;
        }
        pos += 8 + size + (size & 1);
    }
    if (!data || channels <= 0 || rate == 0) throw std::runtime_error("WAV file without sound data");
    if (format != 1 && format != 3) throw std::runtime_error("unsupported WAV encoding");
    const int bytes = bits / 8;
    if (bytes <= 0 || (format == 1 && bytes > 4) || (format == 3 && bytes != 4 && bytes != 8)) throw std::runtime_error("unsupported WAV sample size");
    const size_t frames = dataSize / (static_cast<size_t>(bytes) * channels);
    SampleData s;
    s.channels = channels;
    s.rate = rate;
    s.data.assign(channels, std::vector<float>(frames));
    for (size_t f = 0; f < frames; f++) {
        for (int c = 0; c < channels; c++) {
            const uint8_t* p = data + (f * channels + c) * bytes;
            float v;
            if (format == 3) {
                if (bytes == 4) {
                    std::memcpy(&v, p, 4);
                } else {
                    double d;
                    std::memcpy(&d, p, 8);
                    v = static_cast<float>(d);
                }
            } else if (bytes == 1) {
                v = (p[0] - 128) / 128.0f;
            } else if (bytes == 2) {
                v = static_cast<int16_t>(u16(p)) / 32768.0f;
            } else if (bytes == 3) {
                int32_t x = (p[0] << 8) | (p[1] << 16) | (static_cast<int32_t>(p[2]) << 24);
                v = static_cast<float>(x / 2147483648.0);
            } else {
                v = static_cast<float>(static_cast<int32_t>(u32(p)) / 2147483648.0);
            }
            s.data[c][f] = v;
        }
    }
    return s;
}

SampleData resample(const SampleData& in, double rate) {
    if (std::abs(in.rate - rate) < 1e-9 || in.frames() == 0) {
        SampleData out = in;
        out.rate = rate;
        return out;
    }
    const double ratio = rate / in.rate;
    const size_t outFrames = static_cast<size_t>(std::ceil(in.frames() * ratio));
    const int taps = 16;  // each side
    const double cutoff = std::min(1.0, ratio);  // low-pass when going down
    SampleData out;
    out.channels = in.channels;
    out.rate = rate;
    out.data.assign(in.channels, std::vector<float>(outFrames));
    const double pi = 3.14159265358979323846;
    for (size_t i = 0; i < outFrames; i++) {
        const double x = i / ratio;
        const long centre = static_cast<long>(std::floor(x));
        for (int c = 0; c < in.channels; c++) {
            double acc = 0, norm = 0;
            for (long k = centre - taps + 1; k <= centre + taps; k++) {
                const double d = x - k;
                const double sinc = std::abs(d) < 1e-12 ? 1.0 : std::sin(pi * d * cutoff) / (pi * d * cutoff);
                const double w = 0.42 + 0.5 * std::cos(pi * d / taps) + 0.08 * std::cos(2 * pi * d / taps);  // Blackman
                const double h = sinc * (std::abs(d) < taps ? w : 0);
                norm += h;
                if (k >= 0 && k < static_cast<long>(in.frames())) acc += h * in.data[c][k];
            }
            out.data[c][i] = static_cast<float>(norm > 0 ? acc / norm : 0);
        }
    }
    return out;
}

SampleData reversed(const SampleData& in) {
    SampleData out = in;
    for (auto& ch : out.data) std::reverse(ch.begin(), ch.end());
    return out;
}

}  // namespace bdb

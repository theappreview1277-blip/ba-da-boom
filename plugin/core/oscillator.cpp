#include "oscillator.h"
#include <algorithm>
#include <cmath>
#include <complex>
#include <map>
#include <mutex>

namespace bdb {
namespace {
constexpr float kPiF = 3.14159265358979323846f;
constexpr int kOctaveBands = 3;
constexpr float kCentsPerRange = 1200.0f / kOctaveBands;

/** In-place inverse DFT of a real signal's half spectrum, by FFT: x[n] = sum_k X[k] e^(+i 2 pi k n / N) (no 1/N). */
void inverseFft(std::vector<std::complex<double>>& a) {
    const size_t n = a.size();
    for (size_t i = 1, j = 0; i < n; i++) {
        size_t bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) std::swap(a[i], a[j]);
    }
    for (size_t len = 2; len <= n; len <<= 1) {
        const double ang = 2 * 3.14159265358979323846 / static_cast<double>(len);
        const std::complex<double> wl(std::cos(ang), std::sin(ang));
        for (size_t i = 0; i < n; i += len) {
            std::complex<double> w(1);
            for (size_t k = 0; k < len / 2; k++) {
                const auto u = a[i + k], v = a[i + k + len / 2] * w;
                a[i + k] = u + v;
                a[i + k + len / 2] = u - v;
                w *= wl;
            }
        }
    }
}
}  // namespace

WaveTables::WaveTables(Wave wave, double sampleRate) {
    size_ = sampleRate <= 24000 ? 2048 : sampleRate <= 88200 ? 4096 : 16384;
    const int half = size_ / 2;
    const float nyquist = static_cast<float>(0.5 * sampleRate);
    lowest_ = nyquist / static_cast<float>(half);
    rateScale_ = size_ / sampleRate;
    ranges_ = static_cast<int>(0.5f + kOctaveBands * std::log2(static_cast<float>(size_)));

    // Blink's GenerateBasicWaveform: sine coefficients only.
    std::vector<float> imag(static_cast<size_t>(half), 0.f);
    for (int n = 1; n < half; n++) {
        const float piFactor = 2 / (static_cast<float>(n) * kPiF);
        float b = 0;
        switch (wave) {
            case Sine: b = n == 1 ? 1.f : 0.f; break;
            case Square: b = piFactor * (1 - ((n & 1) ? -1.f : 1.f)); break;
            case Sawtooth: b = piFactor * ((n & 1) ? 1.f : -1.f); break;
            case Triangle:
                b = (n & 1) ? 8.0f / (kPiF * kPiF) / static_cast<float>(n * n) * ((((n - 1) >> 1) & 1) ? -1.f : 1.f) : 0.f;
                break;
        }
        imag[static_cast<size_t>(n)] = b;
    }
    // CreateBandLimitedTables.
    float normalization = 0.5f;
    tables_.resize(static_cast<size_t>(ranges_));
    std::vector<std::complex<double>> spec(static_cast<size_t>(size_));
    for (int r = 0; r < ranges_; r++) {
        const float centsToCull = static_cast<float>(r) * kCentsPerRange;
        const float culling = std::pow(2.0f, -centsToCull / 1200);
        const int partials = static_cast<int>(culling * static_cast<float>(half));
        std::fill(spec.begin(), spec.end(), std::complex<double>(0));
        const int keep = std::min(half, partials + 1);
        for (int i = 1; i < keep; i++) {
            // A sine partial b*sin(2 pi i n / N) is (b / 2i) (e^+ - e^-): half spectrum -i b / 2, and its mirror.
            const double b = imag[static_cast<size_t>(i)];
            spec[static_cast<size_t>(i)] = std::complex<double>(0, -b / 2);
            spec[static_cast<size_t>(size_ - i)] = std::complex<double>(0, b / 2);
        }
        inverseFft(spec);
        auto& t = tables_[static_cast<size_t>(r)];
        t.resize(static_cast<size_t>(size_));
        for (int i = 0; i < size_; i++) t[static_cast<size_t>(i)] = static_cast<float>(spec[static_cast<size_t>(i)].real());
        if (r == 0) {
            float peak = 0;
            for (float x : t) peak = std::max(peak, std::abs(x));
            if (peak > 0) normalization = 1.0f / peak;
        }
        for (float& x : t) x *= normalization;
    }
}

std::shared_ptr<const WaveTables> WaveTables::get(Wave wave, double sampleRate) {
    static std::mutex m;
    static std::map<std::pair<int, double>, std::shared_ptr<const WaveTables>> cache;
    const std::lock_guard<std::mutex> lock(m);
    auto& slot = cache[{static_cast<int>(wave), sampleRate}];
    if (!slot) slot = std::make_shared<WaveTables>(wave, sampleRate);
    return slot;
}

void WaveTables::forFrequency(float frequency, const float*& lower, const float*& higher, float& tableFactor) const {
    frequency = std::abs(frequency);
    const float ratio = frequency > 0 ? frequency / lowest_ : 0.5f;
    const float cents = std::log2(ratio) * 1200;
    float range = 1 + cents / kCentsPerRange;
    range = std::max(range, 0.0f);
    range = std::min(range, static_cast<float>(ranges_ - 1));
    const auto r1 = static_cast<int>(range);
    const int r2 = r1 < ranges_ - 1 ? r1 + 1 : r1;
    lower = tables_[static_cast<size_t>(r2)].data();
    higher = tables_[static_cast<size_t>(r1)].data();
    tableFactor = range - static_cast<float>(r1);
}

void Oscillator::start(std::shared_ptr<const WaveTables> tables, double frequency, double sampleRate, double lateFrames) {
    tables_ = std::move(tables);
    const auto f = static_cast<float>(std::clamp(frequency, -sampleRate / 2, sampleRate / 2));
    tables_->forFrequency(f, lower_, higher_, tableFactor_);
    incr_ = f * static_cast<float>(tables_->rateScale());
    index_ = lateFrames * incr_;
}

float Oscillator::next() {
    const int size = tables_->size();
    const double fl = std::floor(index_);
    const auto i1 = static_cast<int>(fl) & (size - 1);
    const int i2 = (i1 + 1) & (size - 1);
    const auto k = static_cast<float>(index_ - fl);
    const float hi = (1 - k) * higher_[i1] + k * higher_[i2];
    const float lo = (1 - k) * lower_[i1] + k * lower_[i2];
    const float s = (1 - tableFactor_) * hi + tableFactor_ * lo;
    index_ += incr_;
    index_ -= std::floor(index_ / size) * size;
    return s;
}

}  // namespace bdb

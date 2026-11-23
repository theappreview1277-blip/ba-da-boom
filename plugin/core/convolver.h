// Zero-latency convolution for the reverb (Chromium's ConvolverNode gives the exact convolution with
// no added latency): the first 128 taps directly, then uniformly partitioned FFT convolution in two
// levels (128-frame blocks for the rest of the first 2048 taps, 2048-frame blocks after that).
#pragma once
#include <complex>
#include <memory>
#include <vector>

namespace bdb {

/** Radix-2 complex FFT of one size, with its tables. */
class Fft {
public:
    explicit Fft(int size);
    int size() const { return n_; }
    void forward(std::complex<float>* a) const { run(a, false); }
    /** Inverse without the 1/N. */
    void inverse(std::complex<float>* a) const { run(a, true); }

private:
    void run(std::complex<float>* a, bool inverse) const;
    int n_;
    std::vector<int> reverse_;
    std::vector<std::complex<float>> twiddle_;
};

/** Half spectra (bins 0..N/2) of several partitions, real and imaginary parts apart, partition after partition. */
struct Spectra {
    size_t bins = 0, count = 0;
    std::vector<float> re, im;
    void resize(size_t partitions, size_t binCount) {
        count = partitions;
        bins = binCount;
        re.assign(partitions * binCount, 0.f);
        im.assign(partitions * binCount, 0.f);
    }
};

/** One channel's impulse response, split and transformed for Convolver. Immutable, shareable. */
struct ConvolverIr {
    static constexpr int kHead = 128, kBlock1 = 128, kLevel1End = 2048, kBlock2 = 2048;
    std::vector<float> headReversed;  // taps [0, 128), last first
    Spectra level1;                   // 256-point spectra of taps [128, 2048), 128 each
    Spectra level2;                   // 4096-point spectra of taps [2048, end), 2048 each
    size_t length = 0;
    /** `ir` scaled by `scale`. */
    static std::shared_ptr<const ConvolverIr> make(const float* ir, size_t length, float scale);
};

/** One channel of convolution, one frame at a time. */
class Convolver {
public:
    /** Allocates for impulse responses up to `maxLength` frames (not on the audio thread). */
    void prepare(size_t maxLength);
    /** The response to use (its length must be within prepare's). Clears the state. */
    void setIr(std::shared_ptr<const ConvolverIr> ir);
    void reset();
    float process(float x);

private:
    struct Level {
        std::vector<std::complex<float>> block;  // the input block, then its transform
        Spectra fdl;                              // past input blocks' spectra, a ring
        size_t newest = 0;
        std::vector<float> accRe, accIm;
    };
    void finishBlock(Level& level, int blockSize, const Spectra& parts);
    std::shared_ptr<const ConvolverIr> ir_;
    std::vector<float> history_;  // the last kHead inputs (twice, so a window is contiguous)
    size_t historyPos_ = 0;
    Level level1_, level2_;
    std::vector<float> out_;  // future output, by frame (ring)
    long long frame_ = 0;
    size_t maxLevel1_ = 0, maxLevel2_ = 0;
};

}  // namespace bdb

#include "convolver.h"
#include <algorithm>
#include <cmath>
#include <tuple>

namespace bdb {
namespace {
using cf = std::complex<float>;
constexpr int kFft1 = 2 * ConvolverIr::kBlock1, kFft2 = 2 * ConvolverIr::kBlock2;
constexpr size_t kOutRing = 2 * kFft2;

const Fft& fft1() {
    static const Fft f(kFft1);
    return f;
}
const Fft& fft2() {
    static const Fft f(kFft2);
    return f;
}

size_t partitions(size_t from, size_t to, size_t block) { return to > from ? (to - from + block - 1) / block : 0; }

/** Spectra of taps [from, to) of ir in blocks of `block`, each zero-padded to the FFT size. */
void spectra(Spectra& out, const float* ir, size_t from, size_t to, size_t block, float scale, const Fft& fft) {
    const auto n = static_cast<size_t>(fft.size());
    out.resize(partitions(from, to, block), n / 2 + 1);
    std::vector<cf> s(n);
    for (size_t p = 0; p < out.count; p++) {
        std::fill(s.begin(), s.end(), cf{});
        for (size_t i = 0; i < block && from + p * block + i < to; i++) s[i] = ir[from + p * block + i] * scale;
        fft.forward(s.data());
        for (size_t k = 0; k < out.bins; k++) {
            out.re[p * out.bins + k] = s[k].real();
            out.im[p * out.bins + k] = s[k].imag();
        }
    }
}
}  // namespace

Fft::Fft(int size) : n_(size), reverse_(static_cast<size_t>(size)), twiddle_(static_cast<size_t>(size / 2)) {
    int bits = 0;
    while ((1 << bits) < size) bits++;
    for (int i = 0; i < size; i++) {
        int r = 0;
        for (int b = 0; b < bits; b++)
            if (i & (1 << b)) r |= 1 << (bits - 1 - b);
        reverse_[static_cast<size_t>(i)] = r;
    }
    for (int i = 0; i < size / 2; i++) {
        const double a = -2 * 3.14159265358979323846 * i / size;
        twiddle_[static_cast<size_t>(i)] = cf(static_cast<float>(std::cos(a)), static_cast<float>(std::sin(a)));
    }
}

void Fft::run(cf* a, bool inverse) const {
    for (int i = 0; i < n_; i++) {
        const int r = reverse_[static_cast<size_t>(i)];
        if (i < r) std::swap(a[i], a[r]);
    }
    for (int len = 2; len <= n_; len <<= 1) {
        const int half = len / 2, step = n_ / len;
        for (int i = 0; i < n_; i += len)
            for (int k = 0; k < half; k++) {
                // by hand: std::complex's operator* checks for infinities and is far slower
                const cf w = twiddle_[static_cast<size_t>(k * step)];
                const float wr = w.real(), wi = inverse ? -w.imag() : w.imag();
                const cf b = a[i + k + half];
                const cf v(b.real() * wr - b.imag() * wi, b.real() * wi + b.imag() * wr);
                const cf u = a[i + k];
                a[i + k] = u + v;
                a[i + k + half] = u - v;
            }
    }
}

std::shared_ptr<const ConvolverIr> ConvolverIr::make(const float* ir, size_t length, float scale) {
    auto r = std::make_shared<ConvolverIr>();
    r->length = length;
    r->headReversed.assign(kHead, 0.f);
    for (size_t i = 0; i < static_cast<size_t>(kHead) && i < length; i++) r->headReversed[kHead - 1 - i] = ir[i] * scale;
    spectra(r->level1, ir, kHead, std::min<size_t>(length, kLevel1End), kBlock1, scale, fft1());
    spectra(r->level2, ir, kLevel1End, length, kBlock2, scale, fft2());
    return r;
}

void Convolver::prepare(size_t maxLength) {
    maxLevel1_ = partitions(ConvolverIr::kHead, std::min<size_t>(maxLength, ConvolverIr::kLevel1End), ConvolverIr::kBlock1);
    maxLevel2_ = partitions(ConvolverIr::kLevel1End, maxLength, ConvolverIr::kBlock2);
    history_.assign(2 * ConvolverIr::kHead, 0.f);
    for (auto [level, n, count] : {std::tuple{&level1_, kFft1, maxLevel1_}, std::tuple{&level2_, kFft2, maxLevel2_}}) {
        level->block.assign(static_cast<size_t>(n), {});
        level->fdl.resize(std::max<size_t>(count, 1), static_cast<size_t>(n / 2 + 1));
        level->accRe.assign(static_cast<size_t>(n / 2 + 1), 0.f);
        level->accIm.assign(static_cast<size_t>(n / 2 + 1), 0.f);
    }
    out_.assign(kOutRing, 0.f);
    reset();
}

void Convolver::setIr(std::shared_ptr<const ConvolverIr> ir) {
    ir_ = std::move(ir);
    reset();
}

void Convolver::reset() {
    std::fill(history_.begin(), history_.end(), 0.f);
    for (Level* level : {&level1_, &level2_}) {
        std::fill(level->fdl.re.begin(), level->fdl.re.end(), 0.f);
        std::fill(level->fdl.im.begin(), level->fdl.im.end(), 0.f);
        level->newest = 0;
    }
    std::fill(out_.begin(), out_.end(), 0.f);
    historyPos_ = 0;
    frame_ = 0;
}

// A finished input block: its spectrum joins the delay line, and the sum over partitions of past
// blocks times the response's partitions is the output from the next frame on (each level's first
// partition starts one block into the response).
void Convolver::finishBlock(Level& level, int blockSize, const Spectra& parts) {
    if (parts.count == 0) return;
    const Fft& fft = level.block.size() == static_cast<size_t>(kFft1) ? fft1() : fft2();
    const size_t n = level.block.size(), bins = n / 2 + 1, ring = level.fdl.count;
    std::fill(level.block.begin() + blockSize, level.block.end(), cf{});
    fft.forward(level.block.data());
    level.newest = (level.newest + ring - 1) % ring;
    float* nr = level.fdl.re.data() + level.newest * bins;
    float* ni = level.fdl.im.data() + level.newest * bins;
    for (size_t k = 0; k < bins; k++) {
        nr[k] = level.block[k].real();
        ni[k] = level.block[k].imag();
    }
    float* ar = level.accRe.data();
    float* ai = level.accIm.data();
    std::fill(ar, ar + bins, 0.f);
    std::fill(ai, ai + bins, 0.f);
    for (size_t p = 0; p < parts.count; p++) {
        const size_t slot = (level.newest + p) % ring;
        const float* xr = level.fdl.re.data() + slot * bins;
        const float* xi = level.fdl.im.data() + slot * bins;
        const float* hr = parts.re.data() + p * bins;
        const float* hi = parts.im.data() + p * bins;
        for (size_t k = 0; k < bins; k++) {
            ar[k] += xr[k] * hr[k] - xi[k] * hi[k];
            ai[k] += xr[k] * hi[k] + xi[k] * hr[k];
        }
    }
    // The full (conjugate-symmetric) spectrum, back to time.
    for (size_t k = 0; k < bins; k++) level.block[k] = cf(ar[k], ai[k]);
    for (size_t k = bins; k < n; k++) level.block[k] = std::conj(level.block[n - k]);
    fft.inverse(level.block.data());
    const float norm = 1.0f / static_cast<float>(n);
    for (size_t k = 0; k < n; k++) out_[static_cast<size_t>((frame_ + static_cast<long long>(k)) % static_cast<long long>(kOutRing))] += level.block[k].real() * norm;
}

float Convolver::process(float x) {
    if (!ir_) return 0;
    constexpr size_t head = ConvolverIr::kHead;
    // The direct part: taps 0..127 against the newest inputs (history_[pos + 1 .. pos + head] is
    // oldest to newest).
    historyPos_ = (historyPos_ + 1) % head;
    history_[historyPos_] = history_[historyPos_ + head] = x;
    const float* h = ir_->headReversed.data();
    const float* w = history_.data() + historyPos_ + 1;
    float acc[8] = {};
    for (size_t k = 0; k < head; k += 8)
        for (size_t j = 0; j < 8; j++) acc[j] += h[k + j] * w[k + j];
    float y = ((acc[0] + acc[1]) + (acc[2] + acc[3])) + ((acc[4] + acc[5]) + (acc[6] + acc[7]));

    const auto slot = static_cast<size_t>(frame_ % static_cast<long long>(kOutRing));
    y += out_[slot];
    out_[slot] = 0;

    const auto in1 = static_cast<size_t>(frame_ % ConvolverIr::kBlock1), in2 = static_cast<size_t>(frame_ % ConvolverIr::kBlock2);
    level1_.block[in1] = x;
    level2_.block[in2] = x;
    frame_++;
    if (in1 == ConvolverIr::kBlock1 - 1) finishBlock(level1_, ConvolverIr::kBlock1, ir_->level1);
    if (in2 == ConvolverIr::kBlock2 - 1) finishBlock(level2_, ConvolverIr::kBlock2, ir_->level2);
    return y;
}

}  // namespace bdb

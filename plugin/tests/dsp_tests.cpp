// The reverb's convolution against plain direct convolution, and the engine's delay and reverb.
#include <algorithm>
#include <cmath>
#include <fstream>
#include <memory>
#include <random>
#include <sstream>
#include <string>
#include <nlohmann/json.hpp>
#include "../core/convolver.h"
#include "../core/engine.h"
#include "../core/loader.h"
#include "../core/scheduler.h"
#include "test.h"

using namespace bdb;

TEST("the reverb's convolution is exact and adds no latency, for short and 3-second responses") {
    std::mt19937 rng(7);
    std::uniform_real_distribution<float> u(-1, 1);
    Convolver c;
    c.prepare(132300);
    for (size_t length : {1, 100, 128, 129, 2048, 2049, 5000, 132300}) {
        std::vector<float> ir(length), x(12000);
        for (auto& v : ir) v = u(rng);
        for (size_t i = 0; i < x.size(); i++) x[i] = i % 5 == 0 ? u(rng) : 0;
        c.setIr(ConvolverIr::make(ir.data(), length, 0.25f));
        double sig = 0, res = 0;
        for (size_t n = 0; n < x.size(); n++) {
            double ref = 0;
            for (size_t k = 0; k < length && k <= n; k++) ref += 0.25 * ir[k] * x[n - k];
            const double y = c.process(x[n]);
            sig += ref * ref;
            res += (ref - y) * (ref - y);
        }
        const double db = 10 * std::log10(res / sig);
        CHECK(db < -110, "length " + std::to_string(length) + ": " + std::to_string(db) + " dB");
    }
}

namespace {
// Renders two bars of vector case 0 with every track sending to its delay and reverb, in blocks of
// random size, with the track outputs on or off.
struct Sent {
    std::vector<float> left, right, trackSum;
};
Sent renderWithSends(bool trackOutputs) {
    std::ifstream f(BDB_TESTS_DIR "/vectors.json");
    std::stringstream ss;
    ss << f.rdbuf();
    auto j = nlohmann::json::parse(ss.str());
    PlayModel m = parsePlayModel(j["cases"][0]["model"].dump());
    for (auto& t : m.tracks) {
        t.controls.room = 0.4;
        t.controls.delay = 0.3;
        t.controls.delaytime = 0.27;
        t.controls.delayfeedback = 0.6;
    }
    const double rate = 44100, cps = m.bpm / 240;
    SampleSet set = loadSamples(m, {BDB_TESTS_DIR "/../../resources/samples", "/nonexistent"}, rate);
    std::vector<Hit> hits;
    patternHits(m, m.currentPattern, 0, 0, 2, hits);
    std::stable_sort(hits.begin(), hits.end(), [](const Hit& a, const Hit& b) { return a.cycle < b.cycle; });
    auto e = std::make_unique<Engine>();
    e->prepare(rate);
    Sent out;
    std::mt19937 rng(3);
    std::vector<std::vector<float>> tb(2 * kMaxTracks, std::vector<float>(1024));
    float* tp[2 * kMaxTracks] = {};
    if (trackOutputs)
        for (int i = 0; i < 2 * kMaxTracks; i++) tp[i] = tb[static_cast<size_t>(i)].data();
    std::vector<float> l(1024), r(1024);
    const auto total = static_cast<size_t>(6 * rate);
    size_t next = 0;
    for (size_t pos = 0; pos < total;) {
        const auto n = static_cast<int>(std::min<size_t>(total - pos, 1 + rng() % 1024));
        const double t0 = pos / rate, t1 = (pos + static_cast<size_t>(n)) / rate;
        for (; next < hits.size() && hits[next].cycle / cps < t1; next++)
            if (hits[next].cycle >= 0) e->trigger(m, set, hits[next], hits[next].cycle / cps, cps);
        e->render(t0, n, l.data(), r.data(), tp, 1, false);
        for (int i = 0; i < n; i++) {
            out.left.push_back(l[static_cast<size_t>(i)]);
            out.right.push_back(r[static_cast<size_t>(i)]);
            float sum = 0;
            if (trackOutputs)
                for (int k = 0; k < 2 * kMaxTracks; k += 2) sum += tb[static_cast<size_t>(k)][static_cast<size_t>(i)];
            out.trackSum.push_back(sum);
        }
        pos += static_cast<size_t>(n);
    }
    return out;
}
double residual(const std::vector<float>& a, const std::vector<float>& b) {
    double sig = 0, res = 0;
    for (size_t i = 0; i < a.size(); i++) sig += double(a[i]) * a[i], res += (double(a[i]) - b[i]) * (double(a[i]) - b[i]);
    return 10 * std::log10(res / sig + 1e-30);
}
}  // namespace

TEST("delay and reverb: the mix is the same with or without track outputs, and the tracks add up to it") {
    const Sent shared = renderWithSends(false), own = renderWithSends(true);
    const double mix = std::max(residual(own.left, shared.left), residual(own.right, shared.right));
    CHECK(mix < -100, std::to_string(mix) + " dB");
    const double sum = residual(own.left, own.trackSum);
    CHECK(sum < -100, std::to_string(sum) + " dB");
    double energy = 0;
    for (size_t i = static_cast<size_t>(4 * 44100); i < own.left.size(); i++) energy += double(own.left[i]) * own.left[i];
    CHECK(energy > 1e-3, "the delay and reverb ring on after the beat: " + std::to_string(energy));
}

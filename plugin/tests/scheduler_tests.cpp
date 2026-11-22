// The plugin plays the same hits as the app: every case in vectors.json (made from the
// app's own Strudel patterns by test/pluginVectors.test.ts) must come out exactly.
#include <algorithm>
#include <cmath>
#include <fstream>
#include <sstream>
#include <nlohmann/json.hpp>
#include "../core/scheduler.h"
#include "../core/strudel_rng.h"
#include "test.h"

using namespace bdb;
using nlohmann::json;

static json vectors() {
    std::ifstream f(BDB_TESTS_DIR "/vectors.json");
    std::stringstream ss;
    ss << f.rdbuf();
    return json::parse(ss.str());
}

static bool before(const Hit& a, const Hit& b) {
    if (std::abs(a.cycle - b.cycle) > 1e-9) return a.cycle < b.cycle;
    if (a.track != b.track) return a.track < b.track;
    if (a.velocity != b.velocity) return a.velocity < b.velocity;
    return a.length < b.length;
}

// Hits at the same moment on the same track (a step and another's ratchet) may come in either order.
static std::string compare(std::vector<Hit> got, const json& wantJson) {
    std::vector<Hit> want;
    for (auto& w : wantJson) want.push_back({w[0].get<double>(), w[1].get<int>(), w[2].get<double>(), w[3].get<double>()});
    std::sort(got.begin(), got.end(), before);
    std::sort(want.begin(), want.end(), before);
    if (got.size() != want.size()) return "count " + std::to_string(got.size()) + " vs " + std::to_string(want.size());
    for (size_t i = 0; i < got.size(); i++) {
        const Hit& w = want[i];
        if (std::abs(got[i].cycle - w.cycle) > 1e-7 || got[i].track != w.track || std::abs(got[i].velocity - w.velocity) > 1e-12 || std::abs(got[i].length - w.length) > 1e-7) {
            std::ostringstream o;
            o.precision(10);
            o << "hit " << i << ": got " << got[i].cycle << " t" << got[i].track << " v" << got[i].velocity << " len" << got[i].length << ", want " << w.cycle << " t" << w.track << " v" << w.velocity << " len" << w.length;
            return o.str();
        }
    }
    return {};
}

TEST("numbers wrap like JavaScript's") {
    CHECK(toUint32(-1) == 4294967295u);
    CHECK(toUint32(4294967296.0 + 5) == 5u);
}

TEST("every pattern plays the app's hits, for 9 bars") {
    auto v = vectors();
    int n = 0;
    for (auto& c : v["cases"]) {
        PlayModel m = parsePlayModel(c["model"].dump());
        for (size_t p = 0; p < m.patterns.size(); p++) {
            std::vector<Hit> got;
            patternHits(m, static_cast<int>(p), 0, 0, 9, got);
            auto diff = compare(got, c["patterns"][p]);
            CHECK(diff.empty(), "case " + std::to_string(n) + " pattern " + std::to_string(p) + ": " + diff);
        }
        n++;
    }
    CHECK(n >= 12);
}

TEST("hits come out the same when asked for in small blocks") {
    auto v = vectors();
    for (auto& c : v["cases"]) {
        PlayModel m = parsePlayModel(c["model"].dump());
        std::vector<Hit> got;
        // Blocks of odd sizes, as a DAW asks for audio.
        for (double t = 0; t < 9; t += 0.0137) patternHits(m, 0, 0, t, std::min(9.0, t + 0.0137), got);
        CHECK(compare(got, c["patterns"][0]).empty());
    }
}

TEST("songs play the app's hits, looping or ending") {
    auto v = vectors();
    int n = 0;
    for (auto& c : v["cases"]) {
        PlayModel m = parsePlayModel(c["model"].dump());
        std::vector<Hit> got;
        songHits(m, 0, c["song"]["end"].get<double>(), got);
        auto diff = compare(got, c["song"]["hits"]);
        CHECK(diff.empty(), "case " + std::to_string(n) + ": " + diff);
        n++;
    }
}

TEST("songs come out the same when asked for in small blocks") {
    auto v = vectors();
    int n = 0;
    for (auto& c : v["cases"]) {
        PlayModel m = parsePlayModel(c["model"].dump());
        const double end = c["song"]["end"].get<double>();
        std::vector<Hit> got;
        for (double t = 0; t < end; t += 0.0137) songHits(m, t, std::min(end, t + 0.0137), got);
        auto diff = compare(got, c["song"]["hits"]);
        CHECK(diff.empty(), "case " + std::to_string(n) + ": " + diff);
        n++;
    }
}

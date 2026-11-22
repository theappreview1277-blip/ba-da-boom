// The player as a host drives it: any block size, loops and seeks, stop, MIDI in and out,
// mutes, preview and swapping the beat while it plays.
#include <algorithm>
#include <cmath>
#include <fstream>
#include <random>
#include <sstream>
#include <nlohmann/json.hpp>
#include "../core/loader.h"
#include "../core/player.h"
#include "test.h"

using namespace bdb;
using nlohmann::json;

namespace {
constexpr double kRate = 48000;

std::shared_ptr<const Loaded> loadCase(int n) {
    std::ifstream f(BDB_TESTS_DIR "/vectors.json");
    std::stringstream ss;
    ss << f.rdbuf();
    auto j = json::parse(ss.str());
    auto l = std::make_shared<Loaded>();
    l->model = parsePlayModel(j["cases"][n]["model"].dump());
    l->samples = loadSamples(l->model, {BDB_TESTS_DIR "/../../resources/samples", "/nonexistent"}, kRate);
    l->sampleRate = kRate;
    return l;
}

struct Run {
    std::vector<float> left, right;
    std::vector<std::vector<float>> tracks = std::vector<std::vector<float>>(2 * kMaxTracks);
    int noteOns = 0, noteOffs = 0, open = 0, maxOpen = 0;
};

// Plays `seconds` with the host at `bpm` from ppq 0 (or `ppqAt` for each block's start), in blocks of random size.
template <class PpqAt>
Run play(Player& p, double seconds, double bpm, PpqAt ppqAt, unsigned seed = 1, int maxBlock = 1024, bool hostPlaying = true, double loopStart = 0, double loopEnd = 0) {
    Run r;
    std::mt19937 rng(seed);
    std::vector<float> l(maxBlock), rr(maxBlock);
    std::vector<std::vector<float>> tb(2 * kMaxTracks, std::vector<float>(maxBlock));
    float* tp[2 * kMaxTracks];
    for (int i = 0; i < 2 * kMaxTracks; i++) tp[i] = tb[i].data();
    const auto total = static_cast<long>(seconds * kRate);
    for (long done = 0; done < total;) {
        const int n = static_cast<int>(std::min<long>(total - done, 1 + rng() % maxBlock));
        Transport t{hostPlaying, ppqAt(done / kRate), bpm, loopEnd > loopStart, loopStart, loopEnd};
        p.process(t, n, nullptr, 0, l.data(), rr.data(), tp);
        r.left.insert(r.left.end(), l.begin(), l.begin() + n);
        r.right.insert(r.right.end(), rr.begin(), rr.begin() + n);
        for (int i = 0; i < 2 * kMaxTracks; i++) r.tracks[i].insert(r.tracks[i].end(), tb[i].begin(), tb[i].begin() + n);
        for (auto& x : p.notesOut()) {
            if (x.velocity > 0) r.noteOns++, r.open++;
            else r.noteOffs++, r.open--;
            r.maxOpen = std::max(r.maxOpen, r.open);
        }
        done += n;
    }
    return r;
}

double residualDb(const std::vector<float>& a, const std::vector<float>& b) {
    double sig = 0, res = 0;
    for (size_t i = 0; i < std::max(a.size(), b.size()); i++) {
        const double x = i < a.size() ? a[i] : 0, y = i < b.size() ? b[i] : 0;
        sig += x * x;
        res += (x - y) * (x - y);
    }
    return 10 * std::log10(res / std::max(sig, 1e-30) + 1e-30);
}

double energy(const std::vector<float>& a, size_t from = 0, size_t to = SIZE_MAX) {
    double e = 0;
    for (size_t i = from; i < std::min(to, a.size()); i++) e += a[i] * a[i];
    return e;
}

int expectedHits(const PlayModel& m, int pattern, double bars, bool withNotes) {
    std::vector<Hit> h;
    patternHits(m, pattern, 0, 0, bars, h);
    if (!withNotes) return static_cast<int>(h.size());
    return static_cast<int>(std::count_if(h.begin(), h.end(), [&](const Hit& x) { return m.tracks[x.track].note >= 0 && x.velocity > 0; }));
}
}  // namespace

TEST("the player sounds the same for any block size, and like the offline render") {
    auto l = loadCase(0);
    const double bpm = l->model.bpm, bars = 4;
    const double seconds = bars * 240 / bpm;
    auto ppq = [&](double s) { return s * bpm / 60; };
    Player a, b;
    a.prepare(kRate);
    b.prepare(kRate);
    a.setLoaded(l);
    b.setLoaded(l);
    a.pattern = 0;
    b.pattern = 0;
    Run x = play(a, seconds, bpm, ppq, 1, 32);
    Run y = play(b, seconds, bpm, ppq, 2, 2048);
    CHECK(energy(x.left) > 1, "it makes a sound");
    CHECK(residualDb(x.left, y.left) < -120 && residualDb(x.right, y.right) < -120, std::to_string(residualDb(x.left, y.left)));
    Rendered off = renderOffline(l->model, l->samples, 0, static_cast<int>(bars), kRate, 0);
    off.left.resize(x.left.size());
    CHECK(residualDb(off.left, x.left) < -100, std::to_string(residualDb(off.left, x.left)) + " dB against the offline render");
}

TEST("every hit goes out as a MIDI note on its pad's note, and every note is let go") {
    auto l = loadCase(1);
    const double bpm = 120;
    Player p;
    p.prepare(kRate);
    p.setLoaded(l);
    p.pattern = 1;
    Run r = play(p, 8.0, bpm, [&](double s) { return s * bpm / 60; });  // 4 bars
    const int want = expectedHits(l->model, 1, 4, true);
    CHECK(want > 10 && r.noteOns == want, std::to_string(r.noteOns) + " notes, " + std::to_string(want) + " hits");
    Transport stop{false, 16, bpm};
    std::vector<float> l1(256), r1(256);
    p.process(stop, 256, nullptr, 0, l1.data(), r1.data(), nullptr);
    int offs = 0;
    for (auto& x : p.notesOut()) offs += x.velocity == 0;
    CHECK(r.noteOns == r.noteOffs + offs, std::to_string(r.noteOns) + " on, " + std::to_string(r.noteOffs + offs) + " off");
}

TEST("a host loop plays the looped bars again") {
    auto l = loadCase(2);
    const double bpm = 100, bar = 240 / bpm;
    Player p;
    p.prepare(kRate);
    p.setLoaded(l);
    p.pattern = 0;
    // Two bars looped three times: 2,3 then back to 2,3 ...
    auto ppq = [&](double s) { return 8 + std::fmod(s, 2 * bar) * bpm / 60; };
    Run r = play(p, 6 * bar, bpm, ppq, 1, 1024, true, 8, 16);
    std::vector<Hit> h;
    patternHits(l->model, 0, 0, 2, 4, h);
    const int want = 3 * static_cast<int>(std::count_if(h.begin(), h.end(), [&](const Hit& x) { return l->model.tracks[x.track].note >= 0 && x.velocity > 0; }));
    CHECK(r.noteOns == want, std::to_string(r.noteOns) + " notes, want " + std::to_string(want));
    // The second pass sounds like the first.
    const auto two = static_cast<size_t>(2 * bar * kRate);
    std::vector<float> first(r.left.begin() + two / 4, r.left.begin() + two), second(r.left.begin() + two + two / 4, r.left.begin() + 2 * two);
    CHECK(residualDb(first, second) < -20, std::to_string(residualDb(first, second)) + " dB");
}

TEST("stopping the transport fades the sound out within 20 ms") {
    auto l = loadCase(3);
    Player p;
    p.prepare(kRate);
    p.setLoaded(l);
    const double bpm = 140;
    play(p, 2.0, bpm, [&](double s) { return s * bpm / 60; });
    Run after = play(p, 0.5, bpm, [](double) { return 0.0; }, 3, 256, false);
    const auto ms20 = static_cast<size_t>(0.02 * kRate);
    CHECK(energy(after.left, ms20) + energy(after.right, ms20) == 0, std::to_string(energy(after.left, ms20)));
    CHECK(!p.playing.load());
}

TEST("MIDI notes play the pads at the right moment") {
    auto l = loadCase(4);
    Player p;
    p.prepare(kRate);
    p.setLoaded(l);
    int note = -1, track = -1;
    for (int n = 0; n < 128 && note < 0; n++)
        if (l->model.noteMap[n] >= 0 && l->samples.find(l->model.tracks[l->model.noteMap[n]].controls.s, false)) note = n, track = l->model.noteMap[n];
    CHECK(note >= 0, "a note plays a pad with a sound");
    if (note < 0) return;
    std::vector<float> L(512), R(512);
    std::vector<std::vector<float>> tb(2 * kMaxTracks, std::vector<float>(512));
    float* tp[2 * kMaxTracks];
    for (int i = 0; i < 2 * kMaxTracks; i++) tp[i] = tb[i].data();
    NoteIn in{300, note, 1.f};
    p.process(Transport{}, 512, &in, 1, L.data(), R.data(), tp);
    size_t first = 512;
    for (size_t i = 0; i < 512; i++)
        if (L[i] != 0 || R[i] != 0) {
            first = i;
            break;
        }
    // The attack starts from silence, so the first frame of the hit is 0.
    CHECK(first == 300 || first == 301, "first sound at frame " + std::to_string(first));
    CHECK(energy(tb[2 * track]) > 0, "and comes out of its track's output");
    in.note = (note + 1) % 128;
    while (l->model.noteMap[in.note] >= 0) in.note = (in.note + 1) % 128;
    Player q;
    q.prepare(kRate);
    q.setLoaded(l);
    q.process(Transport{}, 512, &in, 1, L.data(), R.data(), nullptr);
    CHECK(energy(std::vector<float>(L.begin(), L.end())) == 0, "a note no pad has plays nothing");
}

TEST("mute and volume act on a track's output and the mix") {
    auto l = loadCase(5);
    const double bpm = 120;
    auto ppq = [&](double s) { return s * bpm / 60; };
    Player a, b;
    for (auto* p : {&a, &b}) {
        p->prepare(kRate);
        p->setLoaded(l);
        p->pattern = 0;
    }
    int loud = -1;
    {
        Player probe;
        probe.prepare(kRate);
        probe.setLoaded(l);
        probe.pattern = 0;
        Run r = play(probe, 2.0, bpm, ppq);
        double best = 0;
        for (int i = 0; i < kMaxTracks; i++)
            if (energy(r.tracks[2 * i]) > best) best = energy(r.tracks[2 * i]), loud = i;
    }
    b.trackMute[loud] = true;
    Run x = play(a, 2.0, bpm, ppq), y = play(b, 2.0, bpm, ppq);
    CHECK(energy(x.tracks[2 * loud]) > 0 && energy(y.tracks[2 * loud]) == 0, "the muted track's output is silent");
    CHECK(energy(y.left) < energy(x.left), "and the mix is quieter");
    Player c;
    c.prepare(kRate);
    c.setLoaded(l);
    c.pattern = 0;
    c.trackGain[loud] = 0.5f;
    Run z = play(c, 2.0, bpm, ppq);
    const double ratio = energy(z.tracks[2 * loud]) / energy(x.tracks[2 * loud]);
    CHECK(std::abs(ratio - 0.25) < 0.01, "half the volume is a quarter of the energy: " + std::to_string(ratio));
}

TEST("preview plays on its own clock at the beat's tempo while the host is stopped") {
    auto l = loadCase(6);
    Player p;
    p.prepare(kRate);
    p.setLoaded(l);
    p.pattern = 0;
    p.preview = true;
    const double bar = 240 / l->model.bpm;
    Run r = play(p, 2 * bar, 0, [](double) { return 0.0; }, 5, 512, false);
    const int want = expectedHits(l->model, 0, 2, true);
    CHECK(r.noteOns == want, std::to_string(r.noteOns) + " vs " + std::to_string(want));
    CHECK(std::abs(p.position.load() - 2) < 0.02, std::to_string(p.position.load()));
}

TEST("the beat can be swapped while it plays, and the old one is freed") {
    auto a = loadCase(7), b = loadCase(8);
    Player p;
    p.prepare(kRate);
    p.setLoaded(a);
    std::weak_ptr<const Loaded> weakA = a;
    const double bpm = 128;
    double at = 0;
    auto ppq = [&](double s) { return (at + s) * bpm / 60; };
    play(p, 0.5, bpm, ppq);
    p.setLoaded(b);
    a.reset();
    at = 0.5;
    Run r = play(p, 1.0, bpm, ppq);
    p.collect();
    CHECK(weakA.expired(), "the old beat is freed once the audio thread moved on");
    CHECK(p.loaded() == b);
    CHECK(r.left.size() == static_cast<size_t>(kRate));
}

TEST("song mode follows the host through the song") {
    auto l = loadCase(9);
    const double bpm = 120;
    Player p;
    p.prepare(kRate);
    p.setLoaded(l);
    p.songMode = true;
    const int bars = l->model.songBars();
    Run r = play(p, bars * 2.0, bpm, [&](double s) { return s * bpm / 60; });
    std::vector<Hit> h;
    songHits(l->model, 0, bars, h);
    const int want = static_cast<int>(std::count_if(h.begin(), h.end(), [&](const Hit& x) { return l->model.tracks[x.track].note >= 0 && x.velocity > 0; }));
    CHECK(r.noteOns == want, std::to_string(r.noteOns) + " vs " + std::to_string(want));
    CHECK(p.songEntry.load() == static_cast<int>(l->model.song.size()) - 1, std::to_string(p.songEntry.load()));
}

TEST("choosing another pattern while playing switches at the next bar line") {
    auto l = loadCase(10);
    const double bpm = 120;
    Player p;
    p.prepare(kRate);
    p.setLoaded(l);
    p.pattern = 0;
    double at = 0;
    auto ppq = [&](double s) { return (at + s) * bpm / 60; };
    Run a = play(p, 2.5, bpm, ppq);  // a bar and a quarter
    p.pattern = 1;
    at = 2.5;
    Run b = play(p, 3.49, bpm, ppq);  // to just before the end of bar 3 (a hit right on the end may round either way)
    CHECK(p.playingPattern.load() == 1, std::to_string(p.playingPattern.load()));
    std::vector<Hit> h;
    patternHits(l->model, 0, 0, 0, 2, h);
    patternHits(l->model, 1, 0, 2, 2.995, h);
    const int want = static_cast<int>(std::count_if(h.begin(), h.end(), [&](const Hit& x) { return l->model.tracks[x.track].note >= 0 && x.velocity > 0; }));
    std::vector<Hit> h1;
    patternHits(l->model, 0, 0, 0, 1.25, h1);
    const int wantA = static_cast<int>(std::count_if(h1.begin(), h1.end(), [&](const Hit& x) { return l->model.tracks[x.track].note >= 0 && x.velocity > 0; }));
    CHECK(a.noteOns == wantA, std::to_string(a.noteOns) + " vs " + std::to_string(wantA) + " in the first bar and a quarter");
    CHECK(a.noteOns + b.noteOns == want, std::to_string(a.noteOns + b.noteOns) + " vs " + std::to_string(want));
}

TEST("track meters move even when the host takes no track outputs") {
    auto l = loadCase(11);
    Player p;
    p.prepare(kRate);
    p.setLoaded(l);
    std::vector<float> L(512), R(512);
    float best = 0;
    for (int b = 0; b < 200; b++) {
        p.process(Transport{true, b * 512 / kRate * 2, 120}, 512, nullptr, 0, L.data(), R.data(), nullptr);
        for (auto& x : p.trackPeak) best = std::max(best, x.exchange(0.f));
    }
    CHECK(best > 0.01, std::to_string(best));
}

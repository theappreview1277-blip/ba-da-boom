// The play model the app's screen sends to the plugin (src/plugin/playModel.ts).
#pragma once
#include <array>
#include <map>
#include <string>
#include <vector>

namespace bdb {

struct Step {
    bool on = false;
    double velocity = 0.8;
    double probability = 1;
    double micro = 0;
    int ratchet = 1;
};

struct Lane {
    int length = 16;
    std::vector<Step> steps;
};

/** A track's superdough controls (fromModel.ts trackControls). Absent controls are NaN or empty. */
struct Controls {
    std::string s;          // superdough sound name (sample key, or synth wave)
    bool synth = false;
    double gain = 1, pan = 0.5, attack = 0;
    double speed = 1, begin = 0, end = 1, note = 0;
    double release = -1;    // < 0: not set (the whole sample plays)
    double decay = -1, sustain = -1;
    int cut = -1;
    std::string ftype;      // "", "24db", "ladder"
    double cutoff = -1, resonance = -1, lpenv = 0, lpattack = 0.005, lpdecay = 0, lpsustain = 0;
    bool hasLpEnv = false;
    double hcutoff = -1, hresonance = -1;
    double bandf = -1, bandq = -1;
    std::string vowel;
    double distort = -1, shape = -1, crush = -1, coarse = -1;
    double tremolo = -1, tremolodepth = 1, phaserrate = -1, phaserdepth = 0.75;
    double delay = 0, delaytime = 0, delayfeedback = 0.5;
    double room = 0, roomsize = 2;
    int orbit = 1;
};

struct Track {
    std::string id, name;
    bool play = false;
    int note = -1;  // the MIDI note the track's pad sends, -1 none
    Controls controls;
};

struct Pattern {
    std::string id, name;
    std::vector<Lane> lanes;  // one per track; length 0 = no lane
};

struct SongEntry {
    int pattern = 0;
    int bars = 1;
};

struct SampleInfo {
    std::string file, source;
};

struct PlayModel {
    int version = 1;
    double bpm = 120, swing = 50, seed = 1, masterVolume = 0.8;
    bool songLoop = false;
    std::vector<SongEntry> song;
    std::vector<Track> tracks;
    std::vector<Pattern> patterns;
    int currentPattern = 0;
    std::map<std::string, SampleInfo> samples;
    /** The track each MIDI note plays (-1 none), by note number. */
    std::array<int, 128> noteMap = [] {
        std::array<int, 128> a;
        a.fill(-1);
        return a;
    }();

    int songBars() const {
        int n = 0;
        for (auto& e : song) n += e.bars;
        return n;
    }
};

/** Parses the JSON text; throws std::runtime_error with a readable message on bad input. */
PlayModel parsePlayModel(const std::string& json);

}  // namespace bdb

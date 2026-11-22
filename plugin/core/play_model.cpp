#include "play_model.h"
#include <cmath>
#include <limits>
#include <stdexcept>
#include <nlohmann/json.hpp>

namespace bdb {
using nlohmann::json;

namespace {
double num(const json& o, const char* k, double fallback) {
    auto it = o.find(k);
    return it != o.end() && it->is_number() ? it->get<double>() : fallback;
}
std::string str(const json& o, const char* k) {
    auto it = o.find(k);
    return it != o.end() && it->is_string() ? it->get<std::string>() : std::string();
}

Controls parseControls(const json& c) {
    Controls x;
    x.s = str(c, "s");
    x.synth = c.contains("note");
    x.gain = num(c, "gain", 1);
    x.pan = num(c, "pan", 0.5);
    x.attack = num(c, "attack", 0);
    x.speed = num(c, "speed", 1);
    x.begin = num(c, "begin", 0);
    x.end = num(c, "end", 1);
    x.note = num(c, "note", 0);
    x.release = num(c, "release", -1);
    x.decay = num(c, "decay", -1);
    x.sustain = num(c, "sustain", -1);
    x.cut = static_cast<int>(num(c, "cut", -1));
    x.ftype = str(c, "ftype");
    x.cutoff = num(c, "cutoff", -1);
    x.resonance = num(c, "resonance", -1);
    x.hasLpEnv = c.contains("lpenv");
    x.lpenv = num(c, "lpenv", 0);
    x.lpattack = num(c, "lpattack", 0.005);
    x.lpdecay = num(c, "lpdecay", 0);
    x.lpsustain = num(c, "lpsustain", 0);
    x.hcutoff = num(c, "hcutoff", -1);
    x.hresonance = num(c, "hresonance", -1);
    x.bandf = num(c, "bandf", -1);
    x.bandq = num(c, "bandq", -1);
    x.vowel = str(c, "vowel");
    x.distort = num(c, "distort", -1);
    x.shape = num(c, "shape", -1);
    x.crush = num(c, "crush", -1);
    x.coarse = num(c, "coarse", -1);
    x.tremolo = num(c, "tremolo", -1);
    x.tremolodepth = num(c, "tremolodepth", 1);
    x.phaserrate = num(c, "phaserrate", -1);
    x.phaserdepth = num(c, "phaserdepth", 0.75);
    x.delay = num(c, "delay", 0);
    x.delaytime = num(c, "delaytime", 0);
    x.delayfeedback = num(c, "delayfeedback", 0.5);
    x.room = num(c, "room", 0);
    x.roomsize = num(c, "roomsize", 2);
    x.orbit = static_cast<int>(num(c, "orbit", 1));
    return x;
}
}  // namespace

PlayModel parsePlayModel(const std::string& text) {
    json j;
    try {
        j = json::parse(text);
    } catch (const std::exception& e) {
        throw std::runtime_error(std::string("The beat could not be read: ") + e.what());
    }
    if (!j.is_object()) throw std::runtime_error("The beat could not be read: not an object");
    PlayModel m;
    m.version = static_cast<int>(num(j, "version", 1));
    if (m.version > 1) throw std::runtime_error("This beat was made by a newer Ba-da-boom. Update the plugin to play it.");
    m.bpm = num(j, "bpm", 120);
    m.swing = num(j, "swing", 50);
    m.seed = num(j, "seed", 1);
    m.masterVolume = num(j, "masterVolume", 0.8);
    m.songLoop = j.value("songLoop", false);
    m.currentPattern = static_cast<int>(num(j, "currentPattern", 0));
    for (auto& t : j.value("tracks", json::array())) {
        Track tr;
        tr.id = str(t, "id");
        tr.name = str(t, "name");
        tr.play = t.value("play", false);
        tr.controls = parseControls(t.value("controls", json::object()));
        m.tracks.push_back(std::move(tr));
    }
    for (auto& p : j.value("patterns", json::array())) {
        Pattern pt;
        pt.id = str(p, "id");
        pt.name = str(p, "name");
        for (auto& l : p.value("lanes", json::array())) {
            Lane lane;
            if (l.is_object()) {
                lane.length = static_cast<int>(num(l, "length", 16));
                for (auto& s : l.value("steps", json::array())) {
                    Step st;
                    st.on = s.at(0).get<double>() != 0;
                    st.velocity = s.at(1).get<double>();
                    st.probability = s.at(2).get<double>();
                    st.micro = s.at(3).get<double>();
                    st.ratchet = static_cast<int>(s.at(4).get<double>());
                    lane.steps.push_back(st);
                }
                lane.length = std::min<int>(lane.length, static_cast<int>(lane.steps.size()));
            } else {
                lane.length = 0;
            }
            pt.lanes.push_back(std::move(lane));
        }
        pt.lanes.resize(m.tracks.size(), Lane{0, {}});
        m.patterns.push_back(std::move(pt));
    }
    for (auto& e : j.value("song", json::array())) {
        SongEntry se{static_cast<int>(num(e, "pattern", 0)), static_cast<int>(num(e, "bars", 1))};
        if (se.pattern >= 0 && se.pattern < static_cast<int>(m.patterns.size()) && se.bars > 0) m.song.push_back(se);
    }
    if (m.currentPattern < 0 || m.currentPattern >= static_cast<int>(m.patterns.size())) m.currentPattern = 0;
    const json samples = j.value("samples", json::object());  // kept alive: items() refers into it
    for (auto& [k, v] : samples.items()) m.samples[k] = {str(v, "file"), str(v, "source")};
    return m;
}

}  // namespace bdb

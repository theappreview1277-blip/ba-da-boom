#include "loader.h"
#include <fstream>
#include <iterator>
#include <set>

namespace bdb {

SampleSet loadSamples(const PlayModel& m, const SampleFolders& folders, double sampleRate, std::vector<std::string>* missing, const SampleSet* reuse) {
    SampleSet set;
    std::set<std::string> forward, backward;
    for (auto& t : m.tracks) {
        if (t.controls.synth || t.controls.s.empty()) continue;
        (t.controls.speed < 0 ? backward : forward).insert(t.controls.s);
    }
    auto load = [&](const std::string& key) -> std::shared_ptr<const SampleData> {
        if (reuse) {
            auto it = reuse->sounds.find(key);
            if (it != reuse->sounds.end() && it->second->rate == sampleRate) return it->second;
        }
        auto info = m.samples.find(key);
        if (info == m.samples.end()) return nullptr;
        std::ifstream f(folders.pathFor(info->second), std::ios::binary);
        if (!f) return nullptr;
        std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
        try {
            return std::make_shared<const SampleData>(resample(decodeWav(bytes.data(), bytes.size()), sampleRate));
        } catch (...) {
            return nullptr;
        }
    };
    for (auto& key : forward) {
        if (auto s = load(key)) set.sounds[key] = s;
        else if (missing) missing->push_back(key);
    }
    for (auto& key : backward) {
        auto s = set.sounds.count(key) ? set.sounds[key] : load(key);
        if (!s) {
            if (missing) missing->push_back(key);
            continue;
        }
        set.sounds[key] = s;
        if (reuse) {
            auto it = reuse->reversedSounds.find(key);
            if (it != reuse->reversedSounds.end() && it->second->rate == sampleRate) {
                set.reversedSounds[key] = it->second;
                continue;
            }
        }
        set.reversedSounds[key] = std::make_shared<const SampleData>(reversed(*s));
    }
    return set;
}

}  // namespace bdb

// Renders a play model offline, like the app's WAV export. Used by the tests that compare
// the plugin's sound with the app's.
//   bdb_render <model.json> <factory folder> <pool folder> <pattern index | song> <bars> <out.wav> [sample rate]
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include "engine.h"
#include "loader.h"

static void writeFloatWav(const char* path, const bdb::Rendered& r, int rate) {
    const uint32_t frames = static_cast<uint32_t>(r.left.size()), bytes = frames * 2 * 4;
    std::ofstream f(path, std::ios::binary);
    auto u32 = [&](uint32_t v) { f.write(reinterpret_cast<const char*>(&v), 4); };
    auto u16 = [&](uint16_t v) { f.write(reinterpret_cast<const char*>(&v), 2); };
    f.write("RIFF", 4);
    u32(36 + bytes);
    f.write("WAVEfmt ", 8);
    u32(16);
    u16(3);
    u16(2);
    u32(rate);
    u32(rate * 8);
    u16(8);
    u16(32);
    f.write("data", 4);
    u32(bytes);
    for (uint32_t i = 0; i < frames; i++) {
        f.write(reinterpret_cast<const char*>(&r.left[i]), 4);
        f.write(reinterpret_cast<const char*>(&r.right[i]), 4);
    }
}

int main(int argc, char** argv) {
    if (argc < 7) {
        std::fprintf(stderr, "usage: bdb_render model.json factory pool pattern|song bars out.wav [rate]\n");
        return 2;
    }
    std::ifstream in(argv[1]);
    std::stringstream ss;
    ss << in.rdbuf();
    try {
        bdb::PlayModel m = bdb::parsePlayModel(ss.str());
        const int rate = argc > 7 ? std::atoi(argv[7]) : 44100;
        std::vector<std::string> missing;
        bdb::SampleSet set = bdb::loadSamples(m, {argv[2], argv[3]}, rate, &missing);
        for (auto& k : missing) std::fprintf(stderr, "missing sound %s\n", k.c_str());
        const int pattern = std::strcmp(argv[4], "song") == 0 ? -1 : std::atoi(argv[4]);
        bdb::Rendered r = bdb::renderOffline(m, set, pattern, std::atoi(argv[5]), rate);
        writeFloatWav(argv[6], r, rate);
        std::printf("{\"events\":%d,\"frames\":%zu}\n", r.events, r.left.size());
    } catch (const std::exception& e) {
        std::fprintf(stderr, "%s\n", e.what());
        return 1;
    }
    return 0;
}

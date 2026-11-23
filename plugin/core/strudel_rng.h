// Strudel's 'precise' random numbers (@strudel/core signal.mjs: _tToT, _decorrelate,
// _murmurHashFinalizer, randAt), reproduced bit for bit so the plugin makes the same
// probability choices as the app. Copyright (C) Strudel contributors, AGPL-3.0-or-later.
#pragma once
#include <cmath>
#include <cstdint>

namespace bdb {

/** JavaScript's ToUint32 of an integral double (wraps modulo 2^32, negatives too). */
inline uint32_t toUint32(double x) {
    const double m = 4294967296.0;
    double r = std::fmod(x, m);
    if (r < 0) r += m;
    return static_cast<uint32_t>(r);
}

inline uint32_t imul(uint32_t a, uint32_t b) { return a * b; }

inline uint32_t murmurFinalizer(uint32_t x) {
    x ^= x >> 16;
    x = imul(x, 0x85ebca6bu);
    x ^= x >> 13;
    x = imul(x, 0xc2b2ae35u);
    x ^= x >> 16;
    return x;
}

/** randAt(T, i, seed) for T = floor(t * 2^29). */
inline double strudelRand(double t, uint32_t i = 0, double seed = 0) {
    const double T = std::floor(t * 536870912.0);
    const uint32_t low = toUint32(T);
    const uint32_t high = toUint32(std::floor(T / 4294967296.0));
    uint32_t key = low ^ imul(high ^ 0x85ebca6bu, 0xc2b2ae35u);
    key ^= imul(i ^ 0x7f4a7c15u, 0x9e3779b9u);
    key ^= imul(toUint32(seed) ^ 0x165667b1u, 0x27d4eb2du);
    return murmurFinalizer(key) / 4294967296.0;
}

/** fromModel.ts stepSeed: one seed per track and step. */
inline double stepSeed(double projectSeed, int trackIndex, int step) {
    return std::fmod(projectSeed * 7919 + trackIndex * 131 + step, 2147483647.0);
}

}  // namespace bdb

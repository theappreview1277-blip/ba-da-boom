// Loading a play model's sounds from disk (off the audio thread).
#pragma once
#include <functional>
#include <string>
#include "engine.h"

namespace bdb {

/** Where a sound's file is: the factory folder for factory sounds, the sample pool for the rest. */
struct SampleFolders {
    std::string factory, pool;
    std::string pathFor(const SampleInfo& s) const { return (s.source == "factory" ? factory : pool) + "/" + s.file; }
};

/**
 * Decodes every sound the model's tracks use, at `sampleRate`. Sounds that cannot be read are left
 * out (their tracks stay silent, as in the app) and named in `missing`.
 */
SampleSet loadSamples(const PlayModel& m, const SampleFolders& folders, double sampleRate, std::vector<std::string>* missing = nullptr,
                      const SampleSet* reuse = nullptr);

}  // namespace bdb

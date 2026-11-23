// Which hits play when: the plugin's version of fromModel.ts (patternFromModel) and
// song.ts (songPattern). One cycle is one 4/4 bar of 16 steps.
#pragma once
#include <vector>
#include "play_model.h"

namespace bdb {

struct Hit {
    double cycle;     // onset, in cycles
    int track;
    double velocity;
    double length;    // in cycles (one step, divided by the ratchet)
};

/**
 * Appends the hits of `pattern` whose onset falls in [begin, end), with the pattern's
 * cycle 0 at `origin`. Not sorted. No allocation when `out` has room.
 */
void patternHits(const PlayModel& m, int pattern, double origin, double begin, double end, std::vector<Hit>& out);

/** Song playback: the song's first bar is cycle 0. Hits in [begin, end). */
void songHits(const PlayModel& m, double begin, double end, std::vector<Hit>& out);

/** The song entry at `cycle` and the cycle it started at, or false after the end (no loop). */
bool songPosition(const PlayModel& m, double cycle, int& index, double& start);

/** fromModel.ts swingOffset, in steps. */
double swingOffset(int step, double swing);

}  // namespace bdb

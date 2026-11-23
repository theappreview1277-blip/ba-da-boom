#include "scheduler.h"
#include <algorithm>
#include <cmath>
#include "strudel_rng.h"

namespace bdb {

double swingOffset(int step, double swing) {
    if (step % 2 == 0) return 0;
    return std::max(0.0, std::min(0.5, swing / 50 - 1));
}

void patternHits(const PlayModel& m, int pi, double origin, double begin, double end, std::vector<Hit>& out) {
    if (pi < 0 || pi >= static_cast<int>(m.patterns.size()) || end <= begin) return;
    const Pattern& p = m.patterns[pi];
    const double lb = (begin - origin) * 16, le = (end - origin) * 16;  // in steps
    for (int ti = 0; ti < static_cast<int>(m.tracks.size()); ti++) {
        if (!m.tracks[ti].play || ti >= static_cast<int>(p.lanes.size())) continue;
        const Lane& lane = p.lanes[ti];
        const int L = lane.length;
        if (L <= 0) continue;
        for (int i = 0; i < L; i++) {
            const Step& st = lane.steps[i];
            if (!st.on) continue;
            const double offset = st.micro + swingOffset(i, m.swing);
            const int r = std::max(1, st.ratchet);
            // Step i of loop k starts at k*L + i + offset steps; its ratchets follow within one step.
            const long long k0 = static_cast<long long>(std::floor((lb - i - offset - 1) / L));
            const long long k1 = static_cast<long long>(std::ceil((le - i - offset) / L));
            const double seed = stepSeed(m.seed, ti, i);
            for (long long k = k0; k <= k1; k++) {
                // Strudel's degradeBy draws one number per repetition of the step (the inner cycle k).
                if (st.probability < 1 && !(strudelRand(static_cast<double>(k), 0, seed) > 1 - st.probability)) continue;
                for (int j = 0; j < r; j++) {
                    const double s = static_cast<double>(k) * L + i + offset + static_cast<double>(j) / r;
                    if (s < lb || s >= le) continue;
                    out.push_back({origin + s / 16, ti, st.velocity, 1.0 / (16.0 * r)});
                }
            }
        }
    }
}

bool songPosition(const PlayModel& m, double cycle, int& index, double& start) {
    const int total = m.songBars();
    if (total <= 0 || cycle < 0) return false;
    const double pass = std::floor(cycle / total);
    if (pass > 0 && !m.songLoop) return false;
    start = pass * total;
    for (index = 0; index < static_cast<int>(m.song.size()); index++) {
        if (cycle < start + m.song[index].bars) return true;
        start += m.song[index].bars;
    }
    return false;
}

void songHits(const PlayModel& m, double begin, double end, std::vector<Hit>& out) {
    double at = begin;
    while (at < end) {
        int index;
        double start;
        if (!songPosition(m, at, index, start)) break;
        const double pieceEnd = std::min(end, start + m.song[index].bars);
        patternHits(m, m.song[index].pattern, start, at, pieceEnd, out);
        at = pieceEnd;
    }
}

}  // namespace bdb

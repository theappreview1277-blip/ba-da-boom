#include "player.h"
#include <algorithm>
#include <cmath>

namespace bdb {

Player::Player() {
    for (auto& g : trackGain) g.store(1.f);
    for (auto& m : trackMute) m.store(false);
    for (auto& p : trackPeak) p.store(0.f);
    hits_.reserve(kMaxHits);
    timed_.reserve(kMaxHits);
    notesOut_.reserve(kMaxNotesOut);
    offs_.reserve(kMaxNotesOut);
}

void Player::prepare(double sampleRate) {
    sr_ = sampleRate;
    engine_.prepare(sampleRate);
    time_ = 0;
    wasPlaying_ = false;
    offs_.clear();
}

void Player::setLoaded(std::shared_ptr<const Loaded> l) {
    std::lock_guard<std::mutex> g(keepLock_);
    if (l) keep_.push_back(l);
    current_.store(l.get());
}

std::shared_ptr<const Loaded> Player::loaded() const {
    std::lock_guard<std::mutex> g(keepLock_);
    const Loaded* c = current_.load();
    for (auto& k : keep_)
        if (k.get() == c) return k;
    return nullptr;
}

void Player::collect() {
    std::lock_guard<std::mutex> g(keepLock_);
    const Loaded* c = current_.load();
    const Loaded* u = inUse_.load();
    keep_.erase(std::remove_if(keep_.begin(), keep_.end(), [&](auto& k) { return k.get() != c && k.get() != u; }), keep_.end());
}

// A hazard pointer: once inUse_ holds what current_ held, collect() will not free it.
const Loaded* Player::acquire() {
    const Loaded* p = current_.load();
    for (;;) {
        inUse_.store(p);
        const Loaded* again = current_.load();
        if (again == p) return p;
        p = again;
    }
}

void Player::process(const Transport& t, int frames, const NoteIn* notes, int noteCount, float* left, float* right, float* const* tracks) {
    notesOut_.clear();
    const Loaded* l = acquire();
    const double blockSeconds = frames / sr_;

    if (!l || l->sampleRate != sr_) {
        // Nothing to play yet (or its sounds are still being decoded for a new sample rate).
        std::fill(left, left + frames, 0.f);
        std::fill(right, right + frames, 0.f);
        if (tracks)
            for (int i = 0; i < 2 * kMaxTracks; i++)
                if (tracks[i]) std::fill(tracks[i], tracks[i] + frames, 0.f);
        playing.store(false);
        wasPlaying_ = false;
        time_ += blockSeconds;
        inUse_.store(nullptr);
        return;
    }
    const PlayModel& m = l->model;

    // Where the block is, in cycles.
    const bool own = !t.playing && preview.load();
    const bool isPlaying = t.playing || own;
    const double cps = (t.playing && t.bpm > 0 ? t.bpm : m.bpm) / 240.0;
    if (own && !wasPlaying_) previewCycle_ = 0;
    const double start = t.playing ? t.ppq / 4.0 : previewCycle_;
    const double end = start + blockSeconds * cps;
    const bool song = songMode.load() && !m.song.empty();
    int pi = pattern.load();
    if (pi < 0 || pi >= static_cast<int>(m.patterns.size())) pi = m.currentPattern;

    timed_.clear();
    if (isPlaying) {
        // Carry on exactly where the last block ended unless the host jumped (a loop, a seek).
        const bool continuous = wasPlaying_ && std::abs(start - nextCycle_) < cps / sr_ + 1e-9;
        const double from = continuous ? nextCycle_ : start;
        if (!continuous || active_ < 0 || active_ >= static_cast<int>(m.patterns.size())) active_ = pi;
        auto collectHits = [&](double a, double b, double timeAtA) {
            hits_.clear();
            if (b <= a) return;
            if (song) {
                songHits(m, a, b, hits_);
            } else {
                // A newly chosen pattern takes over at the next bar line, as in the app.
                const double bar = std::ceil(a - 1e-9);  // a block that starts on a bar line switches at once
                if (active_ != pi && b > bar) {
                    if (bar > a) patternHits(m, active_, 0, a, bar, hits_);
                    active_ = pi;
                    patternHits(m, active_, 0, std::max(a, bar), b, hits_);
                } else {
                    patternHits(m, active_, 0, a, b, hits_);
                }
            }
            for (auto& h : hits_)
                if (timed_.size() < kMaxHits) timed_.push_back({timeAtA + std::max(0.0, (h.cycle - a) / cps), h, true});
        };
        const double loopA = t.loopStart / 4.0, loopB = t.loopEnd / 4.0;
        if (t.playing && t.looping && loopB > loopA && start < loopB && end > loopB) {
            // The loop end falls inside this block: play up to it, then from the loop start.
            collectHits(from, loopB, time_ + (from - start) / cps);
            nextCycle_ = loopA + (end - loopB);
            collectHits(loopA, nextCycle_, time_ + (loopB - start) / cps);
        } else {
            collectHits(from, end, time_ + (from - start) / cps);
            nextCycle_ = end;
        }
        if (own) previewCycle_ = end;
    } else if (wasPlaying_) {
        engine_.stopAll(time_);
    }

    // Notes from the host play the pads.
    for (int i = 0; i < noteCount; i++) {
        const auto& n = notes[i];
        if (n.note > 127 || n.velocity <= 0) continue;
        const int track = n.note >= 0 ? m.noteMap[n.note] : (n.track < static_cast<int>(m.tracks.size()) ? n.track : -1);
        if (track < 0 || timed_.size() >= kMaxHits) continue;
        timed_.push_back({time_ + std::clamp(n.offset, 0, frames - 1) / sr_, Hit{start, track, n.velocity, 1.0 / 16}, false});
    }
    // Onset order (cut groups depend on it); ties as the app's stack orders them, by track.
    std::sort(timed_.begin(), timed_.end(), [](const Timed& a, const Timed& b) {
        return a.time < b.time || (a.time == b.time && a.hit.track < b.hit.track);
    });

    const bool sendMidi = midiOut.load();
    for (auto& x : timed_) {
        engine_.trigger(m, l->samples, x.hit, x.time, cps);
        const int note = x.hit.track < static_cast<int>(m.tracks.size()) ? m.tracks[x.hit.track].note : -1;
        if (sendMidi && x.beat && note >= 0 && x.hit.velocity > 0 && notesOut_.size() + 1 < kMaxNotesOut && offs_.size() < kMaxNotesOut) {
            const int off = std::clamp(static_cast<int>(std::floor((x.time - time_) * sr_)), 0, frames - 1);
            // A quiet hit still sends at least MIDI velocity 1: velocity 0 would mean note off.
            notesOut_.push_back({off, note, static_cast<float>(std::clamp(x.hit.velocity, 1.0 / 127, 1.0))});
            offs_.push_back({x.time + x.hit.length / cps, note});
        }
    }
    // Note offs that fall in this block (all of them when the transport stops).
    for (size_t i = 0; i < offs_.size();) {
        const bool due = offs_[i].time < time_ + blockSeconds || !isPlaying;
        if (due && notesOut_.size() < kMaxNotesOut) {
            const int off = std::clamp(static_cast<int>(std::floor((offs_[i].time - time_) * sr_)), 0, frames - 1);
            notesOut_.push_back({isPlaying ? off : 0, offs_[i].note, 0.f});
            offs_[i] = offs_.back();
            offs_.pop_back();
        } else {
            i++;
        }
    }
    // In time order, offs before ons at the same frame (insertion sort: stable and allocation-free).
    for (size_t i = 1; i < notesOut_.size(); i++) {
        const NoteOut x = notesOut_[i];
        size_t j = i;
        auto before = [](const NoteOut& a, const NoteOut& b) { return a.offset < b.offset || (a.offset == b.offset && a.velocity == 0 && b.velocity > 0); };
        while (j > 0 && before(x, notesOut_[j - 1])) {
            notesOut_[j] = notesOut_[j - 1];
            j--;
        }
        notesOut_[j] = x;
    }

    for (int i = 0; i < kMaxTracks; i++) engine_.setTrackGain(i, trackMute[i].load() ? 0.0 : trackGain[i].load());
    engine_.render(time_, frames, left, right, tracks, m.masterVolume * masterGain.load());

    // Meters.
    float pl = peakL.load(), pr = peakR.load();
    for (int f = 0; f < frames; f++) {
        pl = std::max(pl, std::abs(left[f]));
        pr = std::max(pr, std::abs(right[f]));
    }
    peakL.store(pl);
    peakR.store(pr);
    for (int i = 0; i < kMaxTracks; i++) trackPeak[i].store(std::max(trackPeak[i].load(), engine_.takePeak(i)));

    // What the screen shows.
    playing.store(isPlaying);
    if (isPlaying) {
        position.store(start);
        int index = -1;
        double from = 0;
        const bool inSong = song && songPosition(m, start, index, from);
        songEntry.store(inSong ? index : -1);
        playingPattern.store(song ? (inSong ? m.song[index].pattern : -1) : active_);
    }
    wasPlaying_ = isPlaying;
    time_ += blockSeconds;
    inUse_.store(nullptr);
}

}  // namespace bdb

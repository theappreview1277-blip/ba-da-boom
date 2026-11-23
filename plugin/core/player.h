// The plugin's player: follows the host's transport (or its own clock for previews),
// picks the hits for each audio block, plays MIDI notes on the pads, and renders the
// sound. Plain C++ with no JUCE, so the tests can drive it like a host would.
//
// Threads: setLoaded/collect run on the message thread; process runs on the audio
// thread and never allocates, locks or frees. The settings below are atomics that
// any thread may write.
#pragma once
#include <array>
#include <atomic>
#include <memory>
#include <mutex>
#include <vector>
#include "engine.h"

namespace bdb {

/** A play model with its sounds decoded: what the audio thread plays. Never changed once shared. */
struct Loaded {
    PlayModel model;
    SampleSet samples;
    double sampleRate = 0;
};

struct Transport {
    bool playing = false;  // the host's transport is running
    double ppq = 0;        // host position in quarter notes
    double bpm = 120;
    // The host's loop, in quarter notes. A block that runs past the loop end carries on from its start.
    bool looping = false;
    double loopStart = 0, loopEnd = 0;
};

struct NoteIn {
    int offset;  // frame in the block
    int note;    // MIDI note; -1 to play `track` directly (a pad on the plugin's screen)
    float velocity;  // 0..1
    int track = -1;
};

struct NoteOut {
    int offset;
    int note;
    float velocity;  // 0 = note off
};

class Player {
public:
    static constexpr int kMaxHits = 4096;
    static constexpr int kMaxNotesOut = 1024;

    Player();
    void prepare(double sampleRate);

    /** Message thread: plays `l` from the next block on. The previous one is freed by collect(). */
    void setLoaded(std::shared_ptr<const Loaded> l);
    std::shared_ptr<const Loaded> loaded() const;
    /** Message thread: frees models the audio thread has stopped using. */
    void collect();

    /** Renders one block. `tracks`: kMaxTracks stereo pairs, entries may be null. */
    void process(const Transport& t, int frames, const NoteIn* notes, int noteCount, float* left, float* right, float* const* tracks);
    /** Notes for the host, from the last process call: each played hit as a note on its track's pad note. */
    const std::vector<NoteOut>& notesOut() const { return notesOut_; }

    // Settings, any thread.
    std::atomic<int> pattern{-1};          // pattern index to loop; -1 = the model's current pattern
    std::atomic<bool> songMode{false};     // play the song instead of one pattern
    std::atomic<bool> preview{false};      // play on the plugin's own clock while the host is stopped
    std::atomic<bool> midiOut{true};       // send the beat as MIDI notes
    std::atomic<float> masterGain{1.f};    // on top of the project's master volume
    std::array<std::atomic<float>, kMaxTracks> trackGain;
    std::array<std::atomic<bool>, kMaxTracks> trackMute;

    // State, written by the audio thread.
    std::atomic<bool> playing{false};
    std::atomic<double> position{0};  // in cycles (bars) from the start of the song or host bar 0
    std::atomic<int> songEntry{-1};
    std::atomic<int> playingPattern{-1};  // the pattern being heard (a new choice takes over at the next bar)
    std::array<std::atomic<float>, kMaxTracks> trackPeak;  // since the screen last read them
    std::atomic<float> peakL{0}, peakR{0};

private:
    struct Timed {
        double time;
        Hit hit;
        bool beat;  // from the beat (sent as MIDI out), not a played note
    };
    const Loaded* acquire();

    Engine engine_;
    double sr_ = 44100;
    double time_ = 0;  // engine clock, seconds
    bool wasPlaying_ = false;
    double nextCycle_ = 0, previewCycle_ = 0;
    int active_ = -1;  // the pattern playing; a different choice starts at the next bar line
    std::vector<Hit> hits_;
    std::vector<Timed> timed_;
    std::vector<NoteOut> notesOut_;
    struct PendingOff {
        double time;
        int note;
    };
    std::vector<PendingOff> offs_;

    std::atomic<const Loaded*> current_{nullptr};
    std::atomic<const Loaded*> inUse_{nullptr};
    mutable std::mutex keepLock_;
    std::vector<std::shared_ptr<const Loaded>> keep_;  // message thread: everything that may still be played
};

}  // namespace bdb

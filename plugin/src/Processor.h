// The Ba-da-boom VST3 / CLAP plugin: an instrument that plays the beat in time with the
// host, on a stereo mix and one stereo output per track, with the app's screen as its editor.
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_utils/juce_audio_utils.h>
#include "loader.h"
#include "player.h"

namespace bdb {

/** Where the plugin keeps things on disk (shared with the app where it makes sense). */
struct PluginPaths {
    static juce::File appData();      // %APPDATA%\Ba-da-boom, the app's own folder
    static juce::File pool();         // the app's sample pool: imported sounds by content hash
    static juce::File resources();    // the plugin's screen and factory samples, unpacked once per version
    static juce::File settings();     // the plugin screen's settings
    static juce::File logFile();
    /** Unpacks the screen and factory samples built into the plugin, once per version. */
    static void unpackResources();
};

class Processor : public juce::AudioProcessor, private juce::Timer {
public:
    Processor();
    ~Processor() override;

    void prepareToPlay(double sampleRate, int maxBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout&) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    using AudioProcessor::processBlock;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return "Ba-da-boom"; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return true; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 2.0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return "Default"; }
    void changeProgramName(int, const juce::String&) override {}
    void getStateInformation(juce::MemoryBlock&) override;
    void setStateInformation(const void*, int) override;

    // For the editor (message thread).
    /** Plays a new beat: the play model the screen made, and the project text to keep in the host's project. */
    juce::StringArray setBeat(const juce::String& modelJson, const juce::String& projectText);
    juce::String projectText() const;
    /** A pad on the screen: plays the track at the next block. */
    void padHit(int track, float velocity);
    Player& player() { return player_; }
    juce::AudioProcessorValueTreeState& params() { return params_; }
    double hostBpm() const { return hostBpm_.load(); }
    static void log(const juce::String& level, const juce::String& message);

private:
    void timerCallback() override;
    static juce::AudioProcessorValueTreeState::ParameterLayout layout();
    static BusesProperties buses();
    /** Decodes the model's sounds at `rate` (reusing ones already decoded) and hands it to the player. */
    juce::StringArray load(const juce::String& modelJson, double rate);

    juce::AudioProcessorValueTreeState params_;
    Player player_;
    double rate_ = 0;
    std::atomic<double> hostBpm_{0};

    juce::CriticalSection loadLock_;
    mutable juce::CriticalSection textLock_;
    juce::String modelText_, projectText_;

    // Pads from the screen, into the audio thread without locks.
    juce::AbstractFifo padFifo_{256};
    std::array<NoteIn, 256> pads_{};
    std::vector<NoteIn> notesIn_;

    std::atomic<float>* master_ = nullptr;
    std::atomic<float>* song_ = nullptr;
    std::atomic<float>* pattern_ = nullptr;
    std::atomic<float>* midiOut_ = nullptr;
    std::array<std::atomic<float>*, kMaxTracks> mute_{}, volume_{};

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Processor)
};

}  // namespace bdb

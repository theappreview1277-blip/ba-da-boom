#include "Processor.h"
#include "Editor.h"
#include "BinaryData.h"

namespace bdb {

juce::File PluginPaths::appData() {
    return juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("Ba-da-boom");
}
juce::File PluginPaths::pool() { return appData().getChildFile("sample-pool"); }
juce::File PluginPaths::resources() { return appData().getChildFile("plugin").getChildFile(JucePlugin_VersionString); }
juce::File PluginPaths::settings() { return appData().getChildFile("plugin-settings.json"); }
juce::File PluginPaths::logFile() { return appData().getChildFile("logs").getChildFile("badaboom-plugin.log"); }

void PluginPaths::unpackResources() {
    static juce::CriticalSection lock;
    const juce::ScopedLock l(lock);
    static bool checked = false;  // once per process
    if (checked) return;
    checked = true;
    const auto dir = resources();
    const auto done = dir.getChildFile(".unpacked");
    // Keyed by the content, so a rebuilt plugin of the same version unpacks its new files.
    const auto stamp = juce::String::toHexString(juce::MemoryBlock(BinaryData::ui_zip, BinaryData::ui_zipSize).toBase64Encoding().hashCode64());
    if (done.loadFileAsString() == stamp) return;
    dir.deleteRecursively();
    dir.createDirectory();
    juce::MemoryInputStream in(BinaryData::ui_zip, BinaryData::ui_zipSize, false);
    juce::ZipFile zip(in);
    const auto r = zip.uncompressTo(dir, true);
    if (r.failed()) {
        Processor::log("error", "Could not unpack the plugin's files: " + r.getErrorMessage());
        return;
    }
    done.replaceWithText(stamp);
}

void Processor::log(const juce::String& level, const juce::String& message) {
    static juce::CriticalSection lock;
    const juce::ScopedLock l(lock);
    auto f = PluginPaths::logFile();
    f.getParentDirectory().createDirectory();
    if (f.getSize() > 1 << 20) f.deleteFile();
    f.appendText(juce::Time::getCurrentTime().toISO8601(true) + " " + level + ": " + message + "\n");
}

juce::AudioProcessorValueTreeState::ParameterLayout Processor::layout() {
    using namespace juce;
    AudioProcessorValueTreeState::ParameterLayout l;
    // Shown and typed as a percentage; text and value convert both ways.
    auto pct = AudioParameterFloatAttributes()
                   .withStringFromValueFunction([](float v, int) { return String(v * 100, 1) + "%"; })
                   .withValueFromStringFunction([](const String& t) { return t.retainCharacters("0123456789.-").getFloatValue() / 100.f; });
    l.add(std::make_unique<AudioParameterFloat>(ParameterID{"master", 1}, "Master volume", NormalisableRange<float>(0.f, 1.5f), 1.f, pct));
    l.add(std::make_unique<AudioParameterBool>(ParameterID{"song", 1}, "Play the song", false));
    l.add(std::make_unique<AudioParameterInt>(ParameterID{"pattern", 1}, "Pattern", 0, 64, 0,
                                              AudioParameterIntAttributes()
                                                  .withStringFromValueFunction([](int v, int) { return v == 0 ? String("As saved") : String(v); })
                                                  .withValueFromStringFunction([](const String& t) { return t.trim().equalsIgnoreCase("As saved") ? 0 : t.getIntValue(); })));
    l.add(std::make_unique<AudioParameterBool>(ParameterID{"midiout", 1}, "Send the beat as MIDI", true));
    for (int i = 1; i <= kMaxTracks; i++) {
        l.add(std::make_unique<AudioParameterBool>(ParameterID{"mute" + String(i), 1}, "Track " + String(i) + " mute", false));
        l.add(std::make_unique<AudioParameterFloat>(ParameterID{"vol" + String(i), 1}, "Track " + String(i) + " volume", NormalisableRange<float>(0.f, 1.5f), 1.f, pct));
    }
    return l;
}

juce::AudioProcessor::BusesProperties Processor::buses() {
    auto b = BusesProperties().withOutput("Mix", juce::AudioChannelSet::stereo(), true);
    for (int i = 1; i <= kMaxTracks; i++) b = b.withOutput("Track " + juce::String(i), juce::AudioChannelSet::stereo(), false);
    return b;
}

Processor::Processor() : AudioProcessor(buses()), params_(*this, nullptr, "params", layout()) {
    master_ = params_.getRawParameterValue("master");
    song_ = params_.getRawParameterValue("song");
    pattern_ = params_.getRawParameterValue("pattern");
    midiOut_ = params_.getRawParameterValue("midiout");
    for (int i = 0; i < kMaxTracks; i++) {
        mute_[i] = params_.getRawParameterValue("mute" + juce::String(i + 1));
        volume_[i] = params_.getRawParameterValue("vol" + juce::String(i + 1));
    }
    notesIn_.reserve(1024);
    // A plugin just added to a track plays the app's new-project beat until the screen sends another.
    modelText_ = juce::String::fromUTF8(BinaryData::defaultmodel_json, BinaryData::defaultmodel_jsonSize);
    PluginPaths::unpackResources();
    startTimerHz(2);  // frees beats the audio thread has finished with
}

Processor::~Processor() { stopTimer(); }

void Processor::timerCallback() { player_.collect(); }

bool Processor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    if (!layouts.inputBuses.isEmpty() && !layouts.getMainInputChannelSet().isDisabled()) return false;
    if (layouts.getMainOutputChannelSet() != juce::AudioChannelSet::stereo()) return false;
    for (int i = 1; i < layouts.outputBuses.size(); i++) {
        const auto& set = layouts.outputBuses.getReference(i);
        if (!set.isDisabled() && set != juce::AudioChannelSet::stereo()) return false;
    }
    return true;
}

juce::StringArray Processor::load(const juce::String& modelJson, double rate) {
    juce::StringArray missing;
    if (modelJson.isEmpty() || rate <= 0) return missing;
    const juce::ScopedLock lock(loadLock_);
    auto l = std::make_shared<Loaded>();
    l->model = parsePlayModel(modelJson.toStdString());  // throws on bad input
    std::vector<std::string> miss;
    auto previous = player_.loaded();
    const SampleFolders folders{PluginPaths::resources().getChildFile("samples").getFullPathName().toStdString(), PluginPaths::pool().getFullPathName().toStdString()};
    l->samples = loadSamples(l->model, folders, rate, &miss, previous ? &previous->samples : nullptr);
    l->sampleRate = rate;
    for (auto& m : miss) missing.add(m);
    player_.setLoaded(std::move(l));
    return missing;
}

void Processor::prepareToPlay(double sampleRate, int maxBlock) {
    player_.prepare(sampleRate);
    int enabled = 0;
    for (int i = 1; i < getBusCount(false); i++) enabled += getBus(false, i)->isEnabled() ? 1 : 0;
    log("info", "prepare " + juce::String(sampleRate) + " Hz, " + juce::String(maxBlock) + " frames, " + juce::String(enabled) + " track outputs on");
    if (sampleRate != rate_) {
        rate_ = sampleRate;
        juce::String model;
        {
            const juce::ScopedLock l(textLock_);
            model = modelText_;
        }
        // Decoded here, not on the audio thread: an offline render starts right after this.
        try {
            load(model, rate_);
        } catch (const std::exception& e) {
            log("error", e.what());
        }
    }
}

juce::StringArray Processor::setBeat(const juce::String& modelJson, const juce::String& projectText) {
    auto missing = load(modelJson, rate_ > 0 ? rate_ : 44100);
    {
        const juce::ScopedLock l(textLock_);
        modelText_ = modelJson;
        projectText_ = projectText;
    }
    // The host's project has changed.
    updateHostDisplay(ChangeDetails().withNonParameterStateChanged(true));
    return missing;
}

juce::String Processor::projectText() const {
    const juce::ScopedLock l(textLock_);
    return projectText_;
}

void Processor::padHit(int track, float velocity) {
    const auto scope = padFifo_.write(1);
    if (scope.blockSize1 > 0) pads_[static_cast<size_t>(scope.startIndex1)] = NoteIn{0, -1, velocity, track};
}

void Processor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) {
    juce::ScopedNoDenormals noDenormals;
    const int frames = buffer.getNumSamples();

    Transport t;
    if (auto* head = getPlayHead()) {
        if (auto pos = head->getPosition()) {
            t.playing = pos->getIsPlaying();
            t.ppq = pos->getPpqPosition().orFallback(0.0);
            t.bpm = pos->getBpm().orFallback(0.0);
            t.looping = pos->getIsLooping();
            if (auto lp = pos->getLoopPoints()) {
                t.loopStart = lp->ppqStart;
                t.loopEnd = lp->ppqEnd;
            }
            hostBpm_.store(t.bpm);
        }
    }

    notesIn_.clear();
    for (const auto m : midi) {
        const auto msg = m.getMessage();
        if (msg.isNoteOn() && notesIn_.size() < notesIn_.capacity())
            notesIn_.push_back(NoteIn{m.samplePosition, msg.getNoteNumber(), msg.getFloatVelocity()});
    }
    {
        const auto scope = padFifo_.read(padFifo_.getNumReady());
        for (int i = 0; i < scope.blockSize1; i++)
            if (notesIn_.size() < notesIn_.capacity()) notesIn_.push_back(pads_[static_cast<size_t>(scope.startIndex1 + i)]);
        for (int i = 0; i < scope.blockSize2; i++)
            if (notesIn_.size() < notesIn_.capacity()) notesIn_.push_back(pads_[static_cast<size_t>(scope.startIndex2 + i)]);
    }

    player_.masterGain.store(master_->load());
    player_.songMode.store(song_->load() > 0.5f);
    player_.pattern.store(juce::roundToInt(pattern_->load()) - 1);
    player_.midiOut.store(midiOut_->load() > 0.5f);
    for (int i = 0; i < kMaxTracks; i++) {
        player_.trackMute[i].store(mute_[i]->load() > 0.5f);
        player_.trackGain[i].store(volume_[i]->load());
    }

    // The mix on the main bus; each track on its own bus when the host has switched it on.
    auto mix = getBusBuffer(buffer, false, 0);
    float* tracks[2 * kMaxTracks] = {};
    for (int i = 0; i < kMaxTracks && i + 1 < getBusCount(false); i++) {
        if (!getBus(false, i + 1)->isEnabled()) continue;
        auto b = getBusBuffer(buffer, false, i + 1);
        if (b.getNumChannels() < 2) continue;
        tracks[2 * i] = b.getWritePointer(0);
        tracks[2 * i + 1] = b.getWritePointer(1);
    }
    player_.process(t, frames, notesIn_.data(), static_cast<int>(notesIn_.size()), mix.getWritePointer(0), mix.getWritePointer(1), tracks);
    for (int c = 2; c < mix.getNumChannels(); c++) mix.clear(c, 0, frames);

    midi.clear();
    for (auto& n : player_.notesOut()) {
        // Channel 10, the drum channel.
        midi.addEvent(n.velocity > 0 ? juce::MidiMessage::noteOn(10, n.note, n.velocity) : juce::MidiMessage::noteOff(10, n.note), n.offset);
    }
}

void Processor::getStateInformation(juce::MemoryBlock& dest) {
    juce::XmlElement root("Badaboom");
    root.setAttribute("version", 1);
    if (auto p = params_.copyState().createXml()) root.addChildElement(p.release());
    {
        const juce::ScopedLock l(textLock_);
        root.createNewChildElement("project")->addTextElement(projectText_);
        root.createNewChildElement("model")->addTextElement(modelText_);
    }
    copyXmlToBinary(root, dest);
}

void Processor::setStateInformation(const void* data, int size) {
    auto xml = getXmlFromBinary(data, size);
    if (!xml || !xml->hasTagName("Badaboom")) return;
    if (auto* p = xml->getChildByName(params_.state.getType())) params_.replaceState(juce::ValueTree::fromXml(*p));
    const auto project = xml->getChildElementAllSubText("project", {});
    auto model = xml->getChildElementAllSubText("model", {});
    if (model.isEmpty()) model = juce::String::fromUTF8(BinaryData::defaultmodel_json, BinaryData::defaultmodel_jsonSize);
    try {
        load(model, rate_ > 0 ? rate_ : 44100);
    } catch (const std::exception& e) {
        log("error", juce::String("The saved beat could not be played: ") + e.what());
    }
    {
        const juce::ScopedLock l(textLock_);
        projectText_ = project;
        modelText_ = model;
    }
    if (auto* ed = dynamic_cast<Editor*>(getActiveEditor())) ed->projectReplaced();
}

juce::AudioProcessorEditor* Processor::createEditor() { return new Editor(*this); }

}  // namespace bdb

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new bdb::Processor(); }

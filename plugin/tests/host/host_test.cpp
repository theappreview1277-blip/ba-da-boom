// A small plugin host for the end-to-end tests: loads the built VST3 the way a DAW does,
// gives it a project, plays it with the transport running, and opens its screen.
//
//   bdb_host_test <plugin.vst3> <dir> [--editor seconds]
//
// <dir> holds project.txt (the app's project file) and model.json (its play model). Writes
// into <dir>: mix.wav and track1.wav (float stereo), and host.json with what happened.
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include <cstdio>

using namespace juce;

namespace {
struct PlayHead : AudioPlayHead {
    double ppq = 0, bpm = 120;
    bool playing = true, looping = false;
    double loopStart = 0, loopEnd = 0;
    Optional<PositionInfo> getPosition() const override {
        PositionInfo p;
        p.setIsPlaying(playing);
        p.setPpqPosition(ppq);
        p.setBpm(bpm);
        p.setTimeSignature(TimeSignature{4, 4});
        p.setIsLooping(looping);
        if (looping) p.setLoopPoints(LoopPoints{loopStart, loopEnd});
        return p;
    }
};

void writeWav(const File& f, const AudioBuffer<float>& b, double rate) {
    f.deleteFile();
    WavAudioFormat wav;
    std::unique_ptr<OutputStream> out(f.createOutputStream().release());
    auto w = wav.createWriterFor(out, AudioFormatWriterOptions{}.withSampleRate(rate).withNumChannels(b.getNumChannels()).withBitsPerSample(32).withSampleFormat(AudioFormatWriterOptions::SampleFormat::floatingPoint));
    if (w) w->writeFromAudioSampleBuffer(b, 0, b.getNumSamples());
}

struct Rendered {
    AudioBuffer<float> mix, track1;
    int noteOns = 0, noteOffs = 0;
};

/** Plays `seconds` from ppq 0 in blocks of `block`, with every track output switched on. */
Rendered render(AudioPluginInstance& p, double rate, double bpm, double seconds, int block) {
    PlayHead head;
    head.bpm = bpm;
    p.setPlayHead(&head);
    const int total = static_cast<int>(seconds * rate);
    const int channels = p.getTotalNumOutputChannels();
    AudioBuffer<float> buf(channels, block);
    Rendered r;
    r.mix.setSize(2, total);
    r.track1.setSize(2, total);
    MidiBuffer midi;
    for (int done = 0; done < total; done += block) {
        const int n = std::min(block, total - done);
        AudioBuffer<float> view(buf.getArrayOfWritePointers(), channels, n);
        view.clear();
        midi.clear();
        head.ppq = done / rate * bpm / 60;
        p.processBlock(view, midi);
        for (int c = 0; c < 2; c++) {
            r.mix.copyFrom(c, done, view, c, 0, n);
            if (channels >= 4) r.track1.copyFrom(c, done, view, 2 + c, 0, n);
        }
        for (const auto m : midi) {
            if (m.getMessage().isNoteOn()) r.noteOns++;
            if (m.getMessage().isNoteOff()) r.noteOffs++;
        }
    }
    // The transport stops: every note still sounding is let go.
    head.playing = false;
    AudioBuffer<float> view(buf.getArrayOfWritePointers(), channels, block);
    midi.clear();
    p.processBlock(view, midi);
    for (const auto m : midi) {
        if (m.getMessage().isNoteOn()) r.noteOns++;
        if (m.getMessage().isNoteOff()) r.noteOffs++;
    }
    p.setPlayHead(nullptr);
    return r;
}

double residualDb(const AudioBuffer<float>& a, const AudioBuffer<float>& b) {
    double sig = 0, res = 0;
    for (int c = 0; c < 2; c++)
        for (int i = 0; i < std::min(a.getNumSamples(), b.getNumSamples()); i++) {
            const double x = a.getSample(c, i), y = b.getSample(c, i);
            sig += x * x;
            res += (x - y) * (x - y);
        }
    return 10 * std::log10(res / std::max(sig, 1e-30) + 1e-30);
}

// A VST3 host keeps the plugin's own state inside its own wrapper (JUCE's VST3 host: an XML
// element with the component's state as base64).
MemoryBlock wrapForVst3(const MemoryBlock& pluginState) {
    XmlElement w("VST3PluginState");
    w.createNewChildElement("IComponent")->addTextElement(pluginState.toBase64Encoding());
    MemoryBlock out;
    AudioProcessor::copyXmlToBinary(w, out);
    return out;
}

/** The plugin's own state from what the host stored, read back as XML. */
std::unique_ptr<XmlElement> pluginStateXml(AudioPluginInstance& p) {
    MemoryBlock m;
    p.getStateInformation(m);
    auto w = AudioProcessor::getXmlFromBinary(m.getData(), static_cast<int>(m.getSize()));
    if (!w) return nullptr;
    MemoryBlock inner;
    inner.fromBase64Encoding(w->getChildElementAllSubText("IComponent", {}));
    return AudioProcessor::getXmlFromBinary(inner.getData(), static_cast<int>(inner.getSize()));
}

String projectInState(AudioPluginInstance& p) {
    auto x = pluginStateXml(p);
    return x ? x->getChildElementAllSubText("project", {}) : String();
}
}  // namespace

int main(int argc, char** argv) {
    if (argc < 3) {
        std::fprintf(stderr, "usage: bdb_host_test plugin.vst3 dir [--editor seconds]\n");
        return 2;
    }
    ScopedJuceInitialiser_GUI gui;
    const File pluginFile(File::getCurrentWorkingDirectory().getChildFile(argv[1]));
    const File dir(File::getCurrentWorkingDirectory().getChildFile(argv[2]));
    const double editorSeconds = argc >= 5 && String(argv[3]) == "--editor" ? String(argv[4]).getDoubleValue() : 0;
    auto report = std::make_unique<DynamicObject>();
    auto fail = [&](const String& why) {
        report->setProperty("error", why);
        dir.getChildFile("host.json").replaceWithText(JSON::toString(var(report.release())));
        std::fprintf(stderr, "%s\n", why.toRawUTF8());
        return 1;
    };

    AudioPluginFormatManager formats;
    addDefaultFormatsToManager(formats);
    OwnedArray<PluginDescription> found;
    for (auto* f : formats.getFormats())
        if (f->getName() == "VST3") f->findAllTypesForFile(found, pluginFile.getFullPathName());
    if (found.isEmpty()) return fail("The plugin was not found in " + pluginFile.getFullPathName());
    report->setProperty("name", found[0]->name);
    report->setProperty("isInstrument", found[0]->isInstrument);

    const double rate = 44100;
    const int block = 512;
    String err;
    auto make = [&]() { return formats.createPluginInstance(*found[0], rate, block, err); };
    auto plugin = make();
    if (!plugin) return fail("The plugin did not load: " + err);

    // Every output on: the mix and 16 track outputs.
    auto layout = plugin->getBusesLayout();
    for (auto& b : layout.outputBuses) b = AudioChannelSet::stereo();
    report->setProperty("allOutputs", plugin->setBusesLayout(layout));
    report->setProperty("outputChannels", plugin->getTotalNumOutputChannels());
    report->setProperty("acceptsMidi", plugin->acceptsMidi());
    report->setProperty("producesMidi", plugin->producesMidi());

    // Added to a track with nothing saved, it plays the app's new-project beat.
    {
        auto fresh = make();
        fresh->setBusesLayout(layout);
        fresh->prepareToPlay(rate, block);
        const auto d = render(*fresh, rate, 120, 2.0, block);
        report->setProperty("freshEnergy", d.mix.getRMSLevel(0, 0, d.mix.getNumSamples()));
        report->setProperty("freshNoteOns", d.noteOns);
    }

    // The project, as the plugin keeps it in the host's project.
    const auto projectText = dir.getChildFile("project.txt").loadFileAsString();
    const auto modelText = dir.getChildFile("model.json").loadFileAsString();
    XmlElement root("Badaboom");
    root.setAttribute("version", 1);
    root.createNewChildElement("project")->addTextElement(projectText);
    root.createNewChildElement("model")->addTextElement(modelText);
    MemoryBlock state;
    AudioProcessor::copyXmlToBinary(root, state);
    state = wrapForVst3(state);
    plugin->setStateInformation(state.getData(), static_cast<int>(state.getSize()));
    report->setProperty("projectTaken", projectInState(*plugin) == projectText);
    plugin->prepareToPlay(rate, block);

    const auto model = JSON::parse(modelText);
    const double bpm = model["bpm"];
    const double seconds = 2 * 240 / bpm;  // two bars
    const auto a = render(*plugin, rate, bpm, seconds, block);
    writeWav(dir.getChildFile("mix.wav"), a.mix, rate);
    writeWav(dir.getChildFile("track1.wav"), a.track1, rate);
    report->setProperty("noteOns", a.noteOns);
    report->setProperty("noteOffs", a.noteOffs);
    report->setProperty("frames", a.mix.getNumSamples());

    // Saved by the host and loaded into a fresh copy, it must play the same.
    MemoryBlock saved;
    plugin->getStateInformation(saved);
    auto copy = make();
    copy->setBusesLayout(layout);
    copy->setStateInformation(saved.getData(), static_cast<int>(saved.getSize()));
    copy->prepareToPlay(rate, block);
    const auto b = render(*copy, rate, bpm, seconds, 256);
    report->setProperty("reloadResidualDb", residualDb(a.mix, b.mix));
    report->setProperty("projectKept", projectInState(*copy) == projectText);
    copy.reset();

    // Host automation: track 1 muted.
    if (auto* mute = [&]() -> AudioProcessorParameter* {
            for (auto* p : plugin->getParameters())
                if (p->getName(64) == "Track 1 mute") return p;
            return nullptr;
        }()) {
        mute->setValueNotifyingHost(1.f);
        const auto c = render(*plugin, rate, bpm, seconds, block);
        // After the first block: a mute fades in over one block, so it never clicks.
        report->setProperty("mutedTrack1Energy", c.track1.getRMSLevel(0, block, c.track1.getNumSamples() - block));
        report->setProperty("track1Energy", a.track1.getRMSLevel(0, 0, a.track1.getNumSamples()));
        mute->setValueNotifyingHost(0.f);
    }
    report->setProperty("parameters", plugin->getParameters().size());

    if (editorSeconds > 0) {
        // The screen, in a window, while an "audio thread" keeps the plugin running with the host stopped.
        std::atomic<bool> stop{false};
        PlayHead stopped;
        stopped.playing = false;
        plugin->setPlayHead(&stopped);
        std::thread audio([&] {
            AudioBuffer<float> buf(plugin->getTotalNumOutputChannels(), block);
            MidiBuffer midi;
            while (!stop) {
                buf.clear();
                midi.clear();
                plugin->processBlock(buf, midi);
                std::this_thread::sleep_for(std::chrono::microseconds(static_cast<int>(1e6 * block / rate)));
            }
        });
        auto* editor = plugin->createEditorIfNeeded();
        report->setProperty("editor", editor != nullptr);
        if (editor) {
            DocumentWindow window("Ba-da-boom", Colours::black, 0);
            window.setUsingNativeTitleBar(true);
            window.setContentNonOwned(editor, true);
            window.setVisible(true);
            const auto until = Time::getMillisecondCounterHiRes() + editorSeconds * 1000;
            const auto out = File(SystemStats::getEnvironmentVariable("BDB_PLUGIN_TEST_OUT", {}));
            while (Time::getMillisecondCounterHiRes() < until && !(out.existsAsFile() && out.getSize() > 0)) MessageManager::getInstance()->runDispatchLoopUntil(50);
            report->setProperty("projectAfterEditor", projectInState(*plugin));
            window.clearContentComponent();
            plugin->editorBeingDeleted(editor);
            delete editor;
        }
        stop = true;
        audio.join();
        plugin->setPlayHead(nullptr);
    }
    plugin->releaseResources();
    plugin.reset();
    dir.getChildFile("host.json").replaceWithText(JSON::toString(var(report.release())));
    return 0;
}

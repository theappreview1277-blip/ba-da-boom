#include "Editor.h"
#include <juce_cryptography/juce_cryptography.h>

namespace bdb {

namespace {
// BDB_PLUGIN_TRACE=1 logs how long the screen's requests and files take, and how often the
// status timer runs, to the plugin's log: for finding out where a slow screen spends its time.
bool tracing() {
    static const bool on = juce::SystemStats::getEnvironmentVariable("BDB_PLUGIN_TRACE", {}).isNotEmpty();
    return on;
}
double nowMs() { return juce::Time::getMillisecondCounterHiRes(); }
}  // namespace


namespace {
juce::String mimeFor(const juce::String& path) {
    const auto ext = path.fromLastOccurrenceOf(".", false, false).toLowerCase();
    if (ext == "html") return "text/html";
    if (ext == "js" || ext == "mjs") return "text/javascript";
    if (ext == "css") return "text/css";
    if (ext == "json") return "application/json";
    if (ext == "wav") return "audio/wav";
    if (ext == "svg") return "image/svg+xml";
    if (ext == "png") return "image/png";
    if (ext == "woff2") return "font/woff2";
    if (ext == "txt" || ext == "md") return "text/plain";
    return "application/octet-stream";
}

/** A pool file name: a content hash, nothing that could leave the folder. */
bool safeFileName(const juce::String& f) {
    return f.isNotEmpty() && f.length() < 200 && f.containsOnly("0123456789abcdefABCDEF_-.") && !f.contains("..") && f.endsWithIgnoreCase(".wav");
}

juce::MemoryBlock fromBase64(const juce::String& s) {
    juce::MemoryOutputStream out;
    juce::Base64::convertFromBase64(out, s);
    return out.getMemoryBlock();
}

bool isWav(const juce::MemoryBlock& b) {
    auto* p = static_cast<const char*>(b.getData());
    return b.getSize() > 44 && std::memcmp(p, "RIFF", 4) == 0 && std::memcmp(p + 8, "WAVE", 4) == 0;
}

/** Copies a WAV into the app's sample pool under its content hash, as the app does. */
juce::String addToPool(const juce::MemoryBlock& b) {
    const auto file = juce::SHA256(b).toHexString().substring(0, 32) + ".wav";
    auto dest = PluginPaths::pool().getChildFile(file);
    if (!dest.existsAsFile()) {
        PluginPaths::pool().createDirectory();
        juce::TemporaryFile tmp(dest);
        if (!tmp.getFile().replaceWithData(b.getData(), b.getSize()) || !tmp.overwriteTargetFileWithTemporary())
            throw std::runtime_error("The sound could not be saved in the sample pool.");
    }
    return file;
}

juce::var obj(std::initializer_list<std::pair<const char*, juce::var>> items) {
    auto* o = new juce::DynamicObject();
    for (auto& [k, v] : items) o->setProperty(k, v);
    return juce::var(o);
}
}  // namespace

Editor::Editor(Processor& p) : AudioProcessorEditor(p), proc_(p) {
    using Options = juce::WebBrowserComponent::Options;
    auto options = Options{}
                       .withBackend(Options::Backend::webview2)
                       .withWinWebView2Options(Options::WinWebView2{}
                                                   .withUserDataFolder(PluginPaths::appData().getChildFile("plugin-webview"))
                                                   .withBackgroundColour(juce::Colour(0xff15171c))
                                                   .withStatusBarDisabled())
                       .withNativeIntegrationEnabled()
                       .withEventListener("bdb", [this](const juce::var& m) { handle(m); })
                       .withResourceProvider([this](const juce::String& url) { return resource(url); });
    // For the end-to-end tests only: a script to drive the screen, and a file for its results.
    const auto testScript = juce::SystemStats::getEnvironmentVariable("BDB_PLUGIN_TEST_SCRIPT", {});
    if (testScript.isNotEmpty()) options = options.withUserScript(juce::File(testScript).loadFileAsString());
    web_ = std::make_unique<juce::WebBrowserComponent>(options);
    addAndMakeVisible(*web_);
    web_->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
    setResizable(true, true);
    setResizeLimits(960, 600, 3840, 2160);
    setSize(1280, 800);
    startTimerHz(30);
}

Editor::~Editor() { stopTimer(); }

void Editor::paint(juce::Graphics& g) { g.fillAll(juce::Colour(0xff15171c)); }

void Editor::resized() { web_->setBounds(getLocalBounds()); }

void Editor::projectReplaced() { web_->emitEventIfBrowserIsVisible("bdbProject", obj({})); }

std::optional<juce::WebBrowserComponent::Resource> Editor::resource(const juce::String& url) {
    const auto t0 = nowMs();
    auto r = serve(url);
    if (tracing()) Processor::log("trace", "file " + url + " " + juce::String(r ? static_cast<int>(r->data.size()) : -1) + " bytes, " + juce::String(nowMs() - t0, 1) + " ms");
    return r;
}

std::optional<juce::WebBrowserComponent::Resource> Editor::serve(const juce::String& url) {
    auto path = juce::URL::removeEscapeChars(url.upToFirstOccurrenceOf("?", false, false)).trimCharactersAtStart("/");
    if (path.isEmpty()) path = "index.html";
    juce::File f;
    if (path.startsWith("pool/")) {
        const auto name = path.fromFirstOccurrenceOf("pool/", false, false);
        if (!safeFileName(name)) return std::nullopt;
        f = PluginPaths::pool().getChildFile(name);
    } else {
        if (path.contains("..")) return std::nullopt;
        f = PluginPaths::resources().getChildFile(path);
        if (!f.isAChildOf(PluginPaths::resources())) return std::nullopt;
    }
    juce::MemoryBlock data;
    if (!f.existsAsFile() || !f.loadFileAsData(data)) return std::nullopt;
    juce::WebBrowserComponent::Resource r;
    r.data.resize(data.getSize());
    std::memcpy(r.data.data(), data.getData(), data.getSize());
    r.mimeType = mimeFor(path);
    return r;
}

juce::var Editor::settings() const {
    auto v = juce::JSON::parse(PluginPaths::settings());
    return v.isObject() ? v : juce::var();
}

void Editor::reply(const juce::var& id, bool ok, const juce::var& result) {
    web_->emitEventIfBrowserIsVisible("bdbReply", ok ? obj({{"id", id}, {"ok", true}, {"result", result}}) : obj({{"id", id}, {"ok", false}, {"error", result}}));
}

void Editor::timerCallback() {
    if (tracing()) {
        const auto t = nowMs();
        if (++ticks_ == 1) tickFrom_ = t;
        if (t - tickFrom_ >= 1000) {
            Processor::log("trace", "status timer ran " + juce::String(ticks_ - 1) + " times in " + juce::String(t - tickFrom_, 0) + " ms");
            ticks_ = 0;
        }
    }
    auto& pl = proc_.player();
    juce::Array<juce::var> peaks;
    for (int i = 0; i < kMaxTracks; i++) peaks.add(pl.trackPeak[i].exchange(0.f));
    web_->emitEventIfBrowserIsVisible("bdbState", obj({{"playing", pl.playing.load()},
                                                        {"cycle", pl.position.load()},
                                                        {"songEntry", pl.songEntry.load()},
                                                        {"pattern", pl.playingPattern.load()},
                                                        {"bpm", proc_.hostBpm()},
                                                        {"left", pl.peakL.exchange(0.f)},
                                                        {"right", pl.peakR.exchange(0.f)},
                                                        {"tracks", peaks}}));
}

void Editor::handle(const juce::var& message) {
    const auto t0 = nowMs();
    handleCall(message);
    if (tracing()) Processor::log("trace", "call " + message["name"].toString() + " " + juce::String(nowMs() - t0, 1) + " ms");
}

void Editor::handleCall(const juce::var& message) {
    const auto id = message["id"];
    const auto name = message["name"].toString();
    const auto a = message["args"];
    auto fail = [&](const juce::String& e) { reply(id, false, e); };
    try {
        if (name == "getState") {
            const auto text = proc_.projectText();
            reply(id, true, obj({{"project", text.isEmpty() ? juce::var() : juce::var(text)}, {"settings", settings()}, {"version", JucePlugin_VersionString}, {"pluginFormat", juce::AudioProcessor::getWrapperTypeDescription(proc_.wrapperType)}}));
        } else if (name == "setBeat") {
            juce::Array<juce::var> missing;
            for (auto& m : proc_.setBeat(a["model"].toString(), a["project"].toString())) missing.add(m);
            reply(id, true, missing);
        } else if (name == "transport") {
            proc_.player().preview.store(static_cast<bool>(a["preview"]));
            reply(id, true, {});
        } else if (name == "song") {
            if (auto* p = proc_.params().getParameter("song")) p->setValueNotifyingHost(static_cast<bool>(a["on"]) ? 1.f : 0.f);
            reply(id, true, {});
        } else if (name == "hit") {
            proc_.padHit(static_cast<int>(a["track"]), static_cast<float>(static_cast<double>(a["velocity"])));
            reply(id, true, {});
        } else if (name == "importSample") {
            const auto bytes = fromBase64(a["data"].toString());
            if (bytes.getSize() > 200u * 1024 * 1024) return fail("Sample is larger than 200 MB.");
            if (!isWav(bytes)) return fail(a["name"].toString() + " is not a WAV file.");
            reply(id, true, obj({{"file", addToPool(bytes)}}));
        } else if (name == "settingsSet") {
            PluginPaths::settings().getParentDirectory().createDirectory();
            PluginPaths::settings().replaceWithText(juce::JSON::toString(a["settings"]));
            reply(id, true, {});
        } else if (name == "testReport") {
            const auto out = juce::SystemStats::getEnvironmentVariable("BDB_PLUGIN_TEST_OUT", {});
            if (out.isEmpty()) return fail("not testing");
            juce::File(out).replaceWithText(juce::JSON::toString(a["report"]));
            reply(id, true, {});
        } else if (name == "log") {
            Processor::log(a["level"].toString(), a["message"].toString());
            reply(id, true, {});
        } else if (name == "showInFolder") {
            juce::File(a["path"].toString()).revealToUser();
            reply(id, true, {});
        } else if (name == "openProject") {
            chooser_ = std::make_unique<juce::FileChooser>("Open project", juce::File::getSpecialLocation(juce::File::userDocumentsDirectory), "*.badaboom");
            chooser_->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [this, id](const juce::FileChooser& c) {
                const auto f = c.getResult();
                if (f == juce::File()) return reply(id, true, {});
                const auto text = f.loadFileAsString();
                // Bring the project's collected samples into the pool so they can be played.
                juce::Array<juce::var> missing;
                if (auto* samples = juce::JSON::parse(text)["samples"].getDynamicObject())
                    for (auto& s : samples->getProperties()) {
                        const auto file = s.value["file"].toString();
                        if (s.value["source"].toString() != "user" || !safeFileName(file) || PluginPaths::pool().getChildFile(file).existsAsFile()) continue;
                        juce::MemoryBlock b;
                        if (f.getSiblingFile("samples").getChildFile(file).loadFileAsData(b) && isWav(b)) {
                            PluginPaths::pool().createDirectory();
                            PluginPaths::pool().getChildFile(file).replaceWithData(b.getData(), b.getSize());
                        } else {
                            missing.addIfNotAlreadyThere(file);
                        }
                    }
                reply(id, true, obj({{"path", f.getFullPathName()}, {"text", text}, {"missing", missing}}));
            });
        } else if (name == "saveProject") {
            const auto text = a["text"].toString();
            auto write = [this, id, text](juce::File f) {
                // Collect user samples next to the project so the folder is portable.
                juce::Array<juce::var> notCollected;
                const auto dir = f.getSiblingFile("samples");
                if (auto* samples = juce::JSON::parse(text)["samples"].getDynamicObject())
                    for (auto& s : samples->getProperties()) {
                        const auto file = s.value["file"].toString();
                        if (s.value["source"].toString() != "user" || !safeFileName(file) || dir.getChildFile(file).existsAsFile()) continue;
                        dir.createDirectory();
                        if (!PluginPaths::pool().getChildFile(file).copyFileTo(dir.getChildFile(file))) notCollected.addIfNotAlreadyThere(file);
                    }
                if (!f.replaceWithText(text)) return reply(id, false, "The project could not be saved to " + f.getFullPathName());
                reply(id, true, obj({{"path", f.getFullPathName()}, {"notCollected", notCollected}}));
            };
            const auto given = a["path"].toString();
            if (given.isNotEmpty() && !static_cast<bool>(a["saveAs"])) return write(juce::File(given));
            const auto docs = juce::File::getSpecialLocation(juce::File::userDocumentsDirectory);
            chooser_ = std::make_unique<juce::FileChooser>("Save project", docs.getChildFile(a["name"].toString().isEmpty() ? "Untitled" : a["name"].toString()), "*.badaboom");
            chooser_->launchAsync(juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting, [this, id, write](const juce::FileChooser& c) {
                auto r = c.getResult();
                if (r == juce::File()) return reply(id, true, {});
                // Each project gets its own folder: <chosen>/<name>.badaboom + samples/
                const auto base = r.getFileNameWithoutExtension();
                auto folder = r.getParentDirectory().getFileName() == base ? r.getParentDirectory() : r.getParentDirectory().getChildFile(base);
                folder.createDirectory();
                write(folder.getChildFile(base + ".badaboom"));
            });
        } else if (name == "saveFile") {
            const auto bytes = fromBase64(a["data"].toString());
            const auto ext = a["ext"].toString();
            if (ext != "wav" && ext != "mid") return fail("bad request");
            chooser_ = std::make_unique<juce::FileChooser>(ext == "wav" ? "Export WAV" : "Export MIDI", juce::File::getSpecialLocation(juce::File::userDocumentsDirectory).getChildFile(a["name"].toString() + "." + ext), "*." + ext);
            chooser_->launchAsync(juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting, [this, id, bytes, ext](const juce::FileChooser& c) {
                auto f = c.getResult();
                if (f == juce::File()) return reply(id, true, {});
                f = f.withFileExtension(ext);
                if (!f.replaceWithData(bytes.getData(), bytes.getSize())) return reply(id, false, "Could not write " + f.getFullPathName());
                reply(id, true, f.getFullPathName());
            });
        } else if (name == "saveStems") {
            const auto files = a["files"];
            const auto stemName = a["name"].toString();
            chooser_ = std::make_unique<juce::FileChooser>("Export stems to a folder", juce::File::getSpecialLocation(juce::File::userDocumentsDirectory));
            chooser_->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectDirectories, [this, id, files, stemName](const juce::FileChooser& c) {
                const auto parent = c.getResult();
                if (parent == juce::File()) return reply(id, true, {});
                const auto dir = parent.getChildFile(juce::File::createLegalFileName(stemName + " stems"));
                dir.createDirectory();
                for (auto& file : *files.getArray()) {
                    const auto bytes = fromBase64(file["data"].toString());
                    const auto out = dir.getChildFile(juce::File::createLegalFileName(file["name"].toString()));
                    if (!out.replaceWithData(bytes.getData(), bytes.getSize())) return reply(id, false, "Could not write " + out.getFullPathName());
                }
                reply(id, true, dir.getFullPathName());
            });
        } else {
            fail("Unknown request " + name);
        }
    } catch (const std::exception& e) {
        fail(e.what());
    }
}

}  // namespace bdb

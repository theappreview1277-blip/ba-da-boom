// The plugin's editor: the app's own screen in a web view (WebView2 on Windows), served
// from the unpacked resources. The screen talks to the plugin through one event channel:
//   screen -> plugin:  "bdb"      { id, name, args }
//   plugin -> screen:  "bdbReply" { id, ok, result | error }
//                      "bdbState" { playing, cycle, pattern, songEntry, bpm, peaks... }  (30 times a second)
//                      "bdbProject" {}  the host loaded another project into the plugin
#pragma once
#include <juce_gui_extra/juce_gui_extra.h>
#include "Processor.h"

namespace bdb {

class Editor : public juce::AudioProcessorEditor, private juce::Timer {
public:
    explicit Editor(Processor&);
    ~Editor() override;
    void resized() override;
    void paint(juce::Graphics&) override;
    /** The host replaced the plugin's state: the screen reloads the project. */
    void projectReplaced();

private:
    void timerCallback() override;
    void handle(const juce::var& message);
    void handleCall(const juce::var& message);
    void reply(const juce::var& id, bool ok, const juce::var& result);
    std::optional<juce::WebBrowserComponent::Resource> resource(const juce::String& url);
    std::optional<juce::WebBrowserComponent::Resource> serve(const juce::String& url);
    juce::var settings() const;

    Processor& proc_;
    std::unique_ptr<juce::WebBrowserComponent> web_;
    int ticks_ = 0;
    double tickFrom_ = 0;
    std::unique_ptr<juce::FileChooser> chooser_;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Editor)
};

}  // namespace bdb

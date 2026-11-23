# Ba-da-boom as a VST3 and CLAP plugin

The plugin plays a Ba-da-boom beat inside a DAW, in time with the DAW's transport, and
shows the app's own screen as its editor.

## How it fits together

- **The screen** is the app's renderer (`dist/`), packed into the plugin and shown in a
  web view (WebView2 on Windows). Inside the plugin it uses `src/plugin/bridge.ts` for the
  desktop services and `src/plugin/pluginEngine.ts` in place of the web audio engine.
- **Every edit** sends a *play model* (`src/plugin/playModel.ts`) and the project text to the
  plugin. The project text is what the DAW saves with its project.
- **The C++ engine** (`core/`, no JUCE) plays the play model the way the app's Strudel
  patterns and superdough voices do. `test/pluginVectors.test.ts` writes
  `tests/vectors.json` from the app's own patterns, and the C++ tests must produce exactly
  those hits. `test/e2e/plugin.mjs` checks that the sound matches the app's export.
- **The plugin** (`src/`) is JUCE 9 with clap-juce-extensions: an instrument with a stereo
  mix, 16 stereo track outputs, MIDI in (notes play the pads) and MIDI out (the beat, on
  each pad's note, channel 10). Its controls for the host: master volume, play the song,
  pattern, send MIDI, and a mute and volume for each track.

## Timing

One cycle is one 4/4 bar: the host's position in quarter notes divided by 4. Patterns line
up with the host's bar 1; the song starts at bar 1. The host's tempo is used. A pattern
chosen while playing takes over at the next bar line. When the host is stopped, Play on
the plugin's screen previews the beat at the project's tempo.

## Building

    npm ci && npm run build            # the screen
    cmake -S plugin -B plugin/build -DCMAKE_BUILD_TYPE=Release
    cmake --build plugin/build --config Release

On Windows, the WebView2 SDK must be present:
`nuget install Microsoft.Web.WebView2 -Version 1.0.2903.40 -OutputDirectory <dir>` and
`-DJUCE_WEBVIEW2_PACKAGE_LOCATION=<dir>`. To build offline, point
`FETCHCONTENT_SOURCE_DIR_JUCE`, `FETCHCONTENT_SOURCE_DIR_CJE` and
`FETCHCONTENT_SOURCE_DIR_JSON` at local copies.

## Tests

- `plugin/build/bdb_core_tests`: scheduling against the app's hits, and the player as a
  host drives it (block sizes, loops, stop, MIDI in and out, mutes, song mode).
- `node test/e2e/plugin.mjs`: the plugin's sound against the app's, the built VST3 in a test
  host (`tests/host/host_test.cpp`), and its screen. On Linux the screen is checked in the
  standalone build, because a JUCE host on Linux cannot run a JUCE plugin's web view.
- pluginval at strictness 10 and clap-validator, in `.github/workflows/plugin.yml`.

## Installing

The app's Windows installer includes the plugins and copies them to the per-user plugin
folders, `%LOCALAPPDATA%\Programs\Common\VST3` and `%LOCALAPPDATA%\Programs\Common\CLAP`.
The plugin shares the app's sample pool (`%APPDATA%\Ba-da-boom\sample-pool`), so beats with
imported sounds play in both.

## Not in the plugin yet

Synth tracks, the effects other than filters (vowel, crush, shape, tremolo, phaser,
distortion), delay and reverb, sample folders and kit downloads in the screen. These come
in the next plugin update.

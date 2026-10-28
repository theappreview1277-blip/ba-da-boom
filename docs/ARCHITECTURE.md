# Ba-da-boom architecture

## Layers

```
src/model/          Project model: types, defaults, pure edit operations, undo history,
                    versioned file format (parse/validate/serialize). No audio, no DOM.
src/engine/strudel/ Strudel integration: model -> Strudel Pattern (fromModel.ts),
                    LiveSource (pattern changes at exact cycles), typed Strudel imports.
src/engine/audio/   Real-time engine (AudioContext, Cyclist scheduler, sample loading,
                    master chain, meters) and offline WAV export.
src/main/           Electron main process: window, bdb:// protocol, files, dialogs,
                    sample pool, autosave lock. src/main/ipc.ts is the shared contract.
src/preload/        The only bridge: a fixed set of functions on window.bdb.
src/ui/             React interface. Holds no musical state beyond the project history.
```

The project model is the source of truth. Every grid edit is a pure function
`Project -> Project`; undo/redo are snapshot stacks. The engine receives the whole
project after each change and regenerates the Strudel pattern.

## How Strudel is used

Only documented, exported functions of `@strudel/core` 1.2.6 and
`@strudel/webaudio` 1.3.0 (which re-exports `superdough` 1.3.0):

| Need | Strudel API |
| --- | --- |
| Steps, polymeters | `pure`, `stack`, `Pattern.compress`, `Pattern.slow` (1 cycle = 1 bar of 16 steps; a lane of length L loops every L/16 cycles) |
| Ratchets | `Pattern.ply` |
| Probability | `Pattern.degradeBy` + `Pattern.seed`, with `useRNG('precise')` so seeds are uncorrelated |
| Microtiming, swing | `Pattern.late` |
| Scheduling | `Cyclist` + `getTrigger` from `@strudel/core`, output `webaudioOutput` |
| Voices and effects | superdough controls: `s, gain, velocity, pan, speed, begin, end, attack, release, cut, cutoff, hcutoff, distort, delay, delaytime, delayfeedback, room, roomsize, orbit` |
| Samples | `samples()` to register, `loadBuffer()` to preload |
| Export | `superdough()` into an `OfflineAudioContext`, the approach of `renderPatternAudio` in `@strudel/webaudio`, but returning the buffer and adding a tail |

Each track plays on its own superdough orbit, so delay/reverb are per track and the
orbit output can be metered.

### Timing

* The Cyclist queries ~0.1–0.3 s ahead of the audio clock on its own timer
  (`backgroundThrottling: false` keeps it running when the window is hidden).
  The UI only reads the playhead and meters on animation frames.
* `LiveSource` is the single pattern the scheduler plays. Edits are added as
  segments starting at the next step boundary that has not been scheduled yet;
  pattern switches start at the next bar and restart the new pattern's lanes.
  Scheduled and future audio therefore always agree, with no restart.
* Stop is immediate: scheduling stops, the master fades over 10 ms, and the
  superdough graph is discarded so already-scheduled hits and tails are silenced.

### Reproducible probability

Strudel's random functions are pure functions of pattern time and seed. Each step
gets its own seed derived from the project seed, track and step index. Live
playback from the start and WAV export therefore make the same choices, and the
same project always exports the same file (checked in `test/e2e/timing.mjs`).

### Master chain

`superdough output -> master gain -> soft clipper (-1 dBFS knee) -> output`. Meters
and the clip light read the signal before the clipper. A `DynamicsCompressorNode`
was tried and rejected: in Chromium it adds ~6 ms of look-ahead delay and ducks the
first transient, which changed the first hit of every export.

## Desktop security

* Renderer: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP
  (no remote content; `data:` scripts are allowed only because superdough ships
  its AudioWorklets as data URLs). Navigation and new windows are blocked.
* Everything is served from one origin, `bdb://app`. Imported samples are served
  from `bdb://app/pool/<hash>.wav`. File names from the renderer or project files
  are validated as plain names, so they cannot escape their folders.
* The renderer cannot read or write arbitrary files: it can only import WAV bytes
  (validated RIFF/WAVE, max 200 MB), save/open projects through dialogs, write the
  autosave and save exported WAVs through a dialog.
* Pattern code from the future Strudel editor will run in this same sandboxed
  renderer, which has no filesystem or OS access.

## Files

* Project: `<Name>/<Name>.badaboom` (JSON, `format: "badaboom-project"`, `version: 1`)
  plus `<Name>/samples/` holding copies of every imported sample. The folder is
  portable. Unknown future versions are refused instead of being half-read.
* Imported samples are also kept in a content-addressed pool in the app's data
  folder, so unsaved projects can play them.
* Missing samples: the reference is kept, the track is marked "missing" and is
  silent; dropping a WAV on the track relinks it.
* Autosave every 5 s to the app data folder. A session lock file detects an
  unclean exit; recovery is offered on the next start.

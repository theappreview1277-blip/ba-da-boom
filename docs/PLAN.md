# Staged plan

Each milestone ends with: source in a pull request, a Windows installer built on a
real Windows machine, the checks that were run, and the next concrete task.

## Milestone 1: vertical slice (this PR)

Installed Windows app → load sample → edit beat → play reliably → save project →
export WAV. Includes the sequencer core, sound/mix controls, pattern
copy/paste/switching, autosave/recovery and missing-sample handling.

## Milestone 2: pattern creation

* Done: Euclidean generator per lane (hits, steps, rotation) using `@strudel/core`'s
  `bjorklund` and `rotate` (identical to `euclidRot`), written into the grid so it stays editable
* Done: seeded randomisation with strength, density and locked steps (format 2 adds `Step.locked`)
* Done: variations that keep chosen features (beat skeleton, accents, density), added as a new pattern and queued while playing
* Done: song arrangement (patterns × bars, reorder, loop), song playback with the grid
  following, leaving the song at the next bar with a pattern key, song WAV export

## Milestone 3: performance and polish

* Performance view: large pattern triggers, mutes, queued-switch display
* Resizable panels, display-scaling review at 100/125/150/200 %, full keyboard map
* Sample browser: waveform preview, folder browsing, favourites
* Acoustic kit from a CC0 source (candidate: Versilian Community Sample Library, CC0)

## Milestone 4: export and code

* Stem export (one WAV per track, same offline renderer)
* MIDI file export (Standard MIDI File writer; probability resolved with the seed)
* Optional Strudel code editor (`@strudel/codemirror`, `@strudel/transpiler`):
  a clearly labelled code pattern that plays alongside the grid; grid lanes are
  never overwritten by code

## Later, assessed separately

* MIDI controller input and MIDI clock (Web MIDI in Electron; jitter must be measured)
* Audio device selection (`AudioContext.setSinkId`; superdough already supports it)
* More sample formats (FLAC/MP3/OGG decode via Chromium)
* DAW integration: not possible as a plugin from Electron. ASIO and VST3 are not
  offered; Chromium's Windows audio path is WASAPI shared mode.
